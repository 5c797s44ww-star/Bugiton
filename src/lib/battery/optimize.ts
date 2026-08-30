import { allocateLoad, computeMixOrder } from '../optimizer';
import type { BatteryDispatchResult, BatteryMixPoint, BatteryOptimizationResult, Params } from '../types';
import { createBatteryScratch, simulateBatteryDispatch, type BatteryScratch } from './dispatch';

/**
 * Battery-aware mix optimization. This is an ADDITIVE layer on top of the existing, unmodified
 * wind/solar optimizer (src/lib/optimizer.ts): the DC load schedule for a given (mix, total RE
 * capacity) is still computed by the same `allocateLoad` water-filling as before (Pass 1); the
 * battery then greedily time-shifts whatever surplus/deficit is left (Pass 2, see dispatch.ts).
 * This is a heuristic, not a globally joint load+battery optimum - see dispatch.ts for why that
 * heuristic is well-justified here - but it is monotonic, feasible, and energy-conserving, and
 * it is what makes "does a battery change the optimal wind/solar mix" answerable without a full
 * LP/MILP solver, in keeping with the rest of this app's browser-only, no-generic-solver design.
 *
 * The search is coarser than the no-battery optimizer's (fewer mix points, plus a battery-power
 * grid, each requiring a full bisection over total RE capacity - each evaluation is an O(n)
 * sequential dispatch simulation with no equivalent of the no-battery path's sort-once shortcut)
 * to keep total runtime reasonable for a single UI-triggered computation.
 */

const MIX_STEPS = 10; // 11 points, 10 percentage-point resolution
const BATTERY_POWER_GRID = [0, 0.2, 0.4, 0.6, 0.8, 1.0]; // pu
const BISECTION_ITERS = 20;
const HARD_CAP = 1000; // pu, generous upper bound on searched overbuild

function range(steps: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) out.push(i / steps);
  return out;
}

interface CapacityEvalResult {
  coverage: number;
  load: Float64Array;
  dispatch: BatteryDispatchResult;
}

/** Reusable scratch shared across every bisection step for one (mix, battery-power) pair. */
interface EvalScratch {
  re: Float64Array;
  battery: BatteryScratch;
}

function createEvalScratch(n: number): EvalScratch {
  return { re: new Float64Array(n), battery: createBatteryScratch(n) };
}

function evaluateCapacity(
  windCF: Float64Array,
  solarCF: Float64Array,
  windShare: number,
  totalCapacity: number,
  batteryPowerPu: number,
  batteryEnergyPuH: number,
  params: Params,
  order: Int32Array,
  scratch: EvalScratch,
): CapacityEvalResult {
  const cw = windShare * totalCapacity;
  const cs = (1 - windShare) * totalCapacity;
  const { load } = allocateLoad(windCF, solarCF, cw, cs, params.utilization, params.flexibility, order);

  const n = windCF.length;
  const re = scratch.re;
  for (let t = 0; t < n; t++) re[t] = windCF[t] * cw + solarCF[t] * cs;

  const dispatch = simulateBatteryDispatch(
    load,
    re,
    batteryPowerPu,
    batteryEnergyPuH,
    params.battery.chargeEfficiency,
    params.battery.dischargeEfficiency,
    params.battery.initialSocFraction,
    scratch.battery,
  );

  return { coverage: dispatch.coverageFraction, load, dispatch };
}

interface MinimalCapacityResult {
  capacity: number;
  achievedCoverage: number;
  feasible: boolean;
  load: Float64Array;
  dispatch: BatteryDispatchResult;
}

/** Bisect on total RE capacity (pu) for a fixed mix + battery power, to hit the coverage target. */
function minimalCapacityForMixWithBattery(
  windCF: Float64Array,
  solarCF: Float64Array,
  windShare: number,
  batteryPowerPu: number,
  batteryEnergyPuH: number,
  params: Params,
  order: Int32Array,
): MinimalCapacityResult {
  // One scratch set, reused across every bisection step for this (mix, battery-power) pair -
  // safe because a fresh one is created per pair (see buildBatteryMixPoint), so the result kept
  // after this function returns is never later overwritten by an unrelated evaluation.
  const scratch = createEvalScratch(windCF.length);
  const evalAt = (T: number) =>
    evaluateCapacity(windCF, solarCF, windShare, T, batteryPowerPu, batteryEnergyPuH, params, order, scratch);

  if (params.coverageTarget <= 1e-9) {
    const r = evalAt(0);
    return { capacity: 0, achievedCoverage: r.coverage, feasible: true, load: r.load, dispatch: r.dispatch };
  }

  let lo = 0;
  let hi = 1;
  let hiResult = evalAt(hi);
  while (hiResult.coverage < params.coverageTarget && hi < HARD_CAP) {
    lo = hi;
    hi *= 2;
    hiResult = evalAt(hi);
  }

  if (hiResult.coverage < params.coverageTarget) {
    return { capacity: hi, achievedCoverage: hiResult.coverage, feasible: false, load: hiResult.load, dispatch: hiResult.dispatch };
  }

  for (let i = 0; i < BISECTION_ITERS; i++) {
    const mid = (lo + hi) / 2;
    const midResult = evalAt(mid);
    if (midResult.coverage >= params.coverageTarget) {
      hi = mid;
    } else {
      lo = mid;
    }
    if (hi - lo < 1e-6) break;
  }

  const finalResult = evalAt(hi);
  return { capacity: hi, achievedCoverage: finalResult.coverage, feasible: true, load: finalResult.load, dispatch: finalResult.dispatch };
}

interface BatteryMixPointInternal extends BatteryMixPoint {
  load: Float64Array;
  dispatch: BatteryDispatchResult;
}

function buildBatteryMixPoint(
  windCF: Float64Array,
  solarCF: Float64Array,
  windShare: number,
  durationH: number,
  params: Params,
): BatteryMixPointInternal {
  const order = computeMixOrder(windCF, solarCF, windShare);

  let best: (MinimalCapacityResult & { powerPu: number }) | null = null;
  for (const powerPu of BATTERY_POWER_GRID) {
    const energyPuH = powerPu * durationH;
    const r = minimalCapacityForMixWithBattery(windCF, solarCF, windShare, powerPu, energyPuH, params, order);
    const total = r.capacity + powerPu;
    const bestTotal = best ? best.capacity + best.powerPu : Infinity;
    if (!best || total < bestTotal) {
      best = { ...r, powerPu };
    }
  }
  const chosen = best!;

  const windCapacityPu = windShare * chosen.capacity;
  const solarCapacityPu = (1 - windShare) * chosen.capacity;
  const hasCost = params.windCostPerMW != null && params.solarCostPerMW != null;
  const totalCost = hasCost
    ? windCapacityPu * (params.windCostPerMW as number) + solarCapacityPu * (params.solarCostPerMW as number)
    : null; // battery cost intentionally excluded (not yet modeled - see spec)

  return {
    windShare,
    solarShare: 1 - windShare,
    windCapacityPu,
    solarCapacityPu,
    totalOverbuildPu: chosen.capacity, // wind + solar only, comparable to the no-battery metric
    totalSystemCapacityPu: chosen.capacity + chosen.powerPu,
    totalCost,
    achievedCoverage: chosen.achievedCoverage,
    feasible: chosen.feasible,
    batteryPowerPu: chosen.powerPu,
    batteryEnergyPuH: chosen.powerPu * durationH,
    load: chosen.load,
    dispatch: chosen.dispatch,
  };
}

export function optimizeWithBattery(windCF: Float64Array, solarCF: Float64Array, params: Params): BatteryOptimizationResult {
  if (params.battery.durationH === 0) {
    throw new Error('optimizeWithBattery requires params.battery.durationH > 0; use optimize() for the no-battery case.');
  }

  const shares = range(MIX_STEPS);
  const scan = shares.map((w) => buildBatteryMixPoint(windCF, solarCF, w, params.battery.durationH, params));

  const best = [...scan].sort((a, b) => a.totalSystemCapacityPu - b.totalSystemCapacityPu)[0];

  const n = windCF.length;
  const wind = new Float64Array(n);
  const solar = new Float64Array(n);
  const re = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    wind[t] = windCF[t] * best.windCapacityPu;
    solar[t] = solarCF[t] * best.solarCapacityPu;
    re[t] = wind[t] + solar[t];
  }

  const lowerBand = Math.max(0, params.utilization * (1 - params.flexibility));
  const upperBand = Math.min(1, params.utilization * (1 + params.flexibility));

  return {
    best,
    scan,
    transparencyTable: scan,
    load: best.load,
    re,
    wind,
    solar,
    dispatch: best.dispatch,
    lowerBand,
    upperBand,
  };
}
