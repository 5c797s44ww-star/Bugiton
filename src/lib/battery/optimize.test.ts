import { describe, expect, it } from 'vitest';
import { optimize } from '../optimizer';
import type { Params } from '../types';
import { optimizeWithBattery } from './optimize';

function mkParams(overrides: Partial<Params> = {}): Params {
  return {
    utilization: 0.8,
    coverageTarget: 0.8,
    flexibility: 0.6,
    dcNominalPowerMW: null,
    windCostPerMW: null,
    solarCostPerMW: null,
    objective: 'capacity',
    battery: { durationH: 4, chargeEfficiency: 0.95, dischargeEfficiency: 0.95, initialSocFraction: 0.5 },
    ...overrides,
  };
}

describe('optimizeWithBattery', () => {
  it('throws for durationH = 0 (use optimize() instead - preserves the existing no-battery path)', () => {
    const n = 240;
    const windCF = new Float64Array(n).fill(0.4);
    const solarCF = new Float64Array(n).fill(0.2);
    expect(() => optimizeWithBattery(windCF, solarCF, mkParams({ battery: { ...mkParams().battery, durationH: 0 } }))).toThrow();
  });

  it('makes an otherwise-infeasible coverage target feasible by shifting solar surplus into nighttime deficit', () => {
    // No wind resource at all, clean 12h-day/12h-night solar, zero DC flexibility (constant
    // load). Without a battery this coverage target is provably unreachable no matter how much
    // solar is built (night hours get zero renewable energy, period) - this is the core case
    // for "does a battery make solar usefully compatible with a flexible-but-bounded DC load".
    const days = 20;
    const n = days * 24;
    const windCF = new Float64Array(n); // zero: no wind resource
    const solarCF = new Float64Array(n);
    for (let t = 0; t < n; t++) {
      const h = t % 24;
      solarCF[t] = h >= 6 && h < 18 ? Math.max(0, Math.sin(((h - 6) / 12) * Math.PI)) * 0.9 : 0;
    }

    const params = mkParams({ utilization: 0.5, coverageTarget: 0.6, flexibility: 0 });

    const noBattery = optimize(windCF, solarCF, { ...params, battery: { ...params.battery, durationH: 0 } });
    expect(noBattery.bestCapacity.feasible).toBe(false);
    expect(noBattery.bestCapacity.achievedCoverage).toBeLessThan(0.6);

    for (const durationH of [2, 4, 8] as const) {
      const result = optimizeWithBattery(windCF, solarCF, { ...params, battery: { ...params.battery, durationH } });
      expect(result.best.feasible).toBe(true);
      expect(result.best.achievedCoverage).toBeGreaterThanOrEqual(0.6 - 1e-3);
      expect(result.best.batteryPowerPu).toBeGreaterThan(0);
      expect(result.best.batteryEnergyPuH).toBeCloseTo(result.best.batteryPowerPu * durationH, 6);
    }
  });

  it('never leaves total system capacity worse than the no-battery baseline (battery power can always be 0)', () => {
    const n = 480;
    const windCF = new Float64Array(n).map((_, t) => Math.max(0, 0.4 + 0.3 * Math.sin(t / 20)));
    const solarCF = new Float64Array(n).map((_, t) => Math.max(0, Math.cos(((t % 24) - 12) / 6)));
    const params = mkParams();

    const noBattery = optimize(windCF, solarCF, { ...params, battery: { ...params.battery, durationH: 0 } });
    const withBattery = optimizeWithBattery(windCF, solarCF, params);

    // The battery-power grid always includes 0, so battery-aware mixes can fall back to the
    // no-battery behavior exactly - but the battery-aware search uses a coarser mix grid (10%
    // steps vs. the no-battery search's 1%) for performance, so it can land a few percent worse
    // if the true optimum sits between its grid points. Allow a small, explained slack for that.
    expect(withBattery.best.totalSystemCapacityPu).toBeLessThanOrEqual(noBattery.bestCapacity.totalOverbuildPu * 1.05);
  });

  it('battery energy capacity always equals power capacity times the selected duration', () => {
    const n = 240;
    const windCF = new Float64Array(n).map((_, t) => Math.max(0, 0.5 + 0.3 * Math.sin(t / 10)));
    const solarCF = new Float64Array(n).map((_, t) => Math.max(0, Math.cos(((t % 24) - 12) / 6)));
    for (const durationH of [2, 4, 8] as const) {
      const params = mkParams({ battery: { durationH, chargeEfficiency: 0.95, dischargeEfficiency: 0.95, initialSocFraction: 0.5 } });
      const result = optimizeWithBattery(windCF, solarCF, params);
      for (const point of result.scan) {
        expect(point.batteryEnergyPuH).toBeCloseTo(point.batteryPowerPu * durationH, 9);
      }
    }
  });

  it('scan spans wind share from 0% to 100%', () => {
    const n = 240;
    const windCF = new Float64Array(n).fill(0.4);
    const solarCF = new Float64Array(n).fill(0.3);
    const result = optimizeWithBattery(windCF, solarCF, mkParams());
    expect(result.scan[0].windShare).toBeCloseTo(0);
    expect(result.scan[result.scan.length - 1].windShare).toBeCloseTo(1);
  });

  it('respects a custom charge/discharge efficiency (lower efficiency needs more capacity for the same coverage)', () => {
    const days = 20;
    const n = days * 24;
    const windCF = new Float64Array(n);
    const solarCF = new Float64Array(n);
    for (let t = 0; t < n; t++) {
      const h = t % 24;
      solarCF[t] = h >= 6 && h < 18 ? Math.max(0, Math.sin(((h - 6) / 12) * Math.PI)) * 0.9 : 0;
    }
    const params = mkParams({ utilization: 0.5, coverageTarget: 0.55, flexibility: 0 });

    const highEff = optimizeWithBattery(windCF, solarCF, {
      ...params,
      battery: { durationH: 4, chargeEfficiency: 0.99, dischargeEfficiency: 0.99, initialSocFraction: 0.5 },
    });
    const lowEff = optimizeWithBattery(windCF, solarCF, {
      ...params,
      battery: { durationH: 4, chargeEfficiency: 0.7, dischargeEfficiency: 0.7, initialSocFraction: 0.5 },
    });
    expect(lowEff.best.totalSystemCapacityPu).toBeGreaterThanOrEqual(highEff.best.totalSystemCapacityPu - 1e-3);
  });
});
