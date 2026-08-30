import type { BatteryDispatchResult } from '../types';

/** Reusable scratch buffers so repeated dispatch simulations (e.g. inside a bisection loop) don't
 * allocate a fresh set of Float64Arrays on every call - allocation churn, not arithmetic, is the
 * dominant cost of this simulation when it is run thousands of times per optimization. */
export interface BatteryScratch {
  soc1: Float64Array;
  charge1: Float64Array;
  discharge1: Float64Array;
  soc2: Float64Array;
  charge2: Float64Array;
  discharge2: Float64Array;
  delivered: Float64Array;
  curtailed: Float64Array;
  otherSource: Float64Array;
}

export function createBatteryScratch(n: number): BatteryScratch {
  return {
    soc1: new Float64Array(n),
    charge1: new Float64Array(n),
    discharge1: new Float64Array(n),
    soc2: new Float64Array(n),
    charge2: new Float64Array(n),
    discharge2: new Float64Array(n),
    delivered: new Float64Array(n),
    curtailed: new Float64Array(n),
    otherSource: new Float64Array(n),
  };
}

/**
 * Battery dispatch layered on top of an already-computed DC load[] and renewable RE[] profile
 * (the output of the existing, unmodified `allocateLoad` water-filling). This is a heuristic,
 * not a globally joint load+battery optimum: the DC load schedule is fixed first (as if there
 * were no battery), then the battery greedily time-shifts whatever surplus/deficit remains -
 *
 *   Renewable -> Data center -> Battery -> Curtailment   (surplus hours: re[t] > load[t])
 *   Renewable + Battery -> Data center                    (deficit hours: re[t] < load[t])
 *
 * Every hour is exactly one of "surplus" or "deficit" (or neither), so charge/discharge are
 * mutually exclusive by construction - no explicit mutual-exclusion constraint is needed.
 *
 * Cyclic SOC (`SOC[end] = SOC[start]`) is enforced by running the whole period twice from an
 * initial guess and keeping only the second pass: the dispatch policy is a deterministic
 * function of (SOC, surplus, deficit) alone, and a battery whose duration is small compared to
 * the length of the simulated period "forgets" its starting SOC within the first pass, so the
 * second pass is (to floating-point precision) periodic - its own start and end SOC coincide.
 */
export function simulateBatteryDispatch(
  load: Float64Array,
  re: Float64Array,
  batteryPowerPu: number,
  batteryEnergyPuH: number,
  chargeEfficiency: number,
  dischargeEfficiency: number,
  initialSocFraction: number,
  scratch?: BatteryScratch,
): BatteryDispatchResult {
  const n = load.length;
  const P = Math.max(0, batteryPowerPu);
  const E = Math.max(0, batteryEnergyPuH);
  const s = scratch ?? createBatteryScratch(n);

  function runPass(startSoc: number, soc: Float64Array, charge: Float64Array, discharge: Float64Array): number {
    let prev = startSoc;
    for (let t = 0; t < n; t++) {
      let c = 0;
      let d = 0;
      if (P > 1e-12 && E > 1e-12) {
        const surplus = re[t] - load[t];
        if (surplus > 1e-12) {
          // Headroom limit: stored energy after charging (c * chargeEfficiency) must not exceed E.
          c = Math.min(surplus, P, (E - prev) / chargeEfficiency);
          c = Math.max(0, c);
        } else if (surplus < -1e-12) {
          const deficit = -surplus;
          // Availability limit: energy drawn from storage (d / dischargeEfficiency) must not exceed prev.
          d = Math.min(deficit, P, prev * dischargeEfficiency);
          d = Math.max(0, d);
        }
      }
      const next = prev + c * chargeEfficiency - d / dischargeEfficiency;
      soc[t] = next;
      charge[t] = c;
      discharge[t] = d;
      prev = next;
    }
    return prev;
  }

  const initialSoc = initialSocFraction * E;
  const warmupEndSoc = runPass(initialSoc, s.soc1, s.charge1, s.discharge1);
  runPass(warmupEndSoc, s.soc2, s.charge2, s.discharge2);
  const soc = s.soc2;
  const charge = s.charge2;
  const discharge = s.discharge2;

  let coveredEnergy = 0;
  let curtailedEnergy = 0;
  let otherSourceEnergy = 0;
  let totalDcEnergy = 0;
  let dischargeThroughput = 0;
  let maxSoc = 0;

  for (let t = 0; t < n; t++) {
    const direct = Math.min(re[t], load[t]);
    s.delivered[t] = direct + discharge[t];
    const surplus = Math.max(re[t] - load[t], 0);
    const deficit = Math.max(load[t] - re[t], 0);
    s.curtailed[t] = Math.max(0, surplus - charge[t]);
    s.otherSource[t] = Math.max(0, deficit - discharge[t]);
    coveredEnergy += s.delivered[t];
    curtailedEnergy += s.curtailed[t];
    otherSourceEnergy += s.otherSource[t];
    totalDcEnergy += load[t];
    dischargeThroughput += dischargeEfficiency > 1e-12 ? discharge[t] / dischargeEfficiency : 0;
    if (soc[t] > maxSoc) maxSoc = soc[t];
  }

  return {
    soc,
    charge,
    discharge,
    delivered: s.delivered,
    curtailed: s.curtailed,
    otherSource: s.otherSource,
    coveredEnergy,
    curtailedEnergy,
    otherSourceEnergy,
    totalDcEnergy,
    coverageFraction: totalDcEnergy > 0 ? coveredEnergy / totalDcEnergy : 0,
    maxSoc,
    cycles: E > 1e-12 ? dischargeThroughput / E : 0,
  };
}
