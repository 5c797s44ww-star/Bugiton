import { describe, expect, it } from 'vitest';
import { allocateLoad, optimize } from './optimizer';
import type { Params } from './types';

function mkParams(overrides: Partial<Params> = {}): Params {
  return {
    utilization: 0.8,
    coverageTarget: 0.8,
    flexibility: 0.6,
    dcNominalPowerMW: null,
    windCostPerMW: null,
    solarCostPerMW: null,
    objective: 'capacity',
    ...overrides,
  };
}

describe('allocateLoad', () => {
  it('keeps a constant load equal to utilization when flexibility is 0', () => {
    const n = 24;
    const windCF = new Float64Array(n).map((_, i) => (i % 2 === 0 ? 0.9 : 0.1));
    const solarCF = new Float64Array(n).fill(0);
    const result = allocateLoad(windCF, solarCF, 1, 0, 0.8, 0);
    for (const v of result.load) {
      expect(v).toBeCloseTo(0.8, 10);
    }
  });

  it('always keeps average load equal to utilization regardless of flexibility', () => {
    const n = 200;
    const windCF = new Float64Array(n);
    const solarCF = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      windCF[i] = Math.max(0, Math.sin(i / 10) * 0.5 + 0.5);
      solarCF[i] = Math.max(0, Math.cos(i / 7) * 0.5 + 0.5);
    }
    for (const f of [0, 0.25, 0.6, 1]) {
      const result = allocateLoad(windCF, solarCF, 1.5, 1.2, 0.7, f);
      const avg = result.totalDcEnergy / n;
      expect(avg).toBeCloseTo(0.7, 6);
    }
  });

  it('keeps every hourly load within the flexibility band', () => {
    const n = 100;
    const windCF = new Float64Array(n).map(() => Math.random());
    const solarCF = new Float64Array(n).map(() => Math.random());
    const utilization = 0.6;
    const flexibility = 0.4;
    const lower = utilization * (1 - flexibility);
    const upper = utilization * (1 + flexibility);
    const result = allocateLoad(windCF, solarCF, 1, 1, utilization, flexibility);
    for (const v of result.load) {
      expect(v).toBeGreaterThanOrEqual(lower - 1e-9);
      expect(v).toBeLessThanOrEqual(upper + 1e-9);
    }
  });

  it('increasing capacity never decreases the coverage fraction', () => {
    const n = 500;
    const windCF = new Float64Array(n).map((_, i) => Math.max(0, Math.sin(i / 20)));
    const solarCF = new Float64Array(n).map((_, i) => Math.max(0, Math.cos(i / 13)));
    let prevCoverage = -1;
    for (const cap of [0, 0.2, 0.5, 1, 2, 5, 10]) {
      const result = allocateLoad(windCF, solarCF, cap * 0.5, cap * 0.5, 0.8, 0.5);
      expect(result.coverageFraction).toBeGreaterThanOrEqual(prevCoverage - 1e-9);
      prevCoverage = result.coverageFraction;
    }
  });

  it('with full flexibility (100%) the load band spans [0, 1]', () => {
    const n = 50;
    const windCF = new Float64Array(n).fill(0.3);
    const solarCF = new Float64Array(n).fill(0.2);
    const result = allocateLoad(windCF, solarCF, 0.1, 0.1, 0.5, 1);
    for (const v of result.load) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('optimize', () => {
  it('finds a mix that achieves at least the requested coverage', () => {
    const n = 8760;
    const windCF = new Float64Array(n).map((_, i) => Math.max(0, 0.4 + 0.3 * Math.sin(i / 100)));
    const solarCF = new Float64Array(n).map((_, i) => Math.max(0, Math.cos(((i % 24) - 12) / 6)));
    const params = mkParams();
    const result = optimize(windCF, solarCF, params);
    expect(result.best.achievedCoverage).toBeGreaterThanOrEqual(params.coverageTarget - 1e-3);
  });

  it('allows solutions where one technology share is 0%', () => {
    const n = 1000;
    // Only solar has any output; wind is always zero.
    const windCF = new Float64Array(n).fill(0);
    const solarCF = new Float64Array(n).map((_, i) => Math.max(0, Math.cos(((i % 24) - 12) / 6)));
    const params = mkParams({ coverageTarget: 0.5 });
    const result = optimize(windCF, solarCF, params);
    expect(result.best.windShare).toBeCloseTo(0, 6);
  });

  it('cost objective picks the cheapest feasible mix, which may differ from capacity-optimal', () => {
    const n = 2000;
    const windCF = new Float64Array(n).map((_, i) => Math.max(0, 0.5 + 0.4 * Math.sin(i / 50)));
    const solarCF = new Float64Array(n).map((_, i) => Math.max(0, Math.cos(((i % 24) - 12) / 6)));
    const capacityParams = mkParams({ windCostPerMW: 1_000_000, solarCostPerMW: 400_000, objective: 'capacity' });
    const costParams = { ...capacityParams, objective: 'cost' as const };
    const capacityResult = optimize(windCF, solarCF, capacityParams);
    const costResult = optimize(windCF, solarCF, costParams);
    // Cost-optimal total cost should never exceed the capacity-optimal mix's cost.
    expect(costResult.best.totalCost).toBeLessThanOrEqual((capacityResult.best.totalCost as number) + 1e-6);
  });

  it('transparency table spans wind share from 0% to 100% in coarse steps', () => {
    const n = 1000;
    const windCF = new Float64Array(n).map(() => 0.4);
    const solarCF = new Float64Array(n).map(() => 0.3);
    const result = optimize(windCF, solarCF, mkParams());
    expect(result.transparencyTable.length).toBeGreaterThanOrEqual(11);
    expect(result.transparencyTable[0].windShare).toBeCloseTo(0);
    expect(result.transparencyTable[result.transparencyTable.length - 1].windShare).toBeCloseTo(1);
  });

  it('always includes the actual best-capacity and best-cost mixes as highlightable rows', () => {
    const n = 2000;
    const windCF = new Float64Array(n).map((_, i) => Math.max(0, 0.5 + 0.4 * Math.sin(i / 33)));
    const solarCF = new Float64Array(n).map((_, i) => Math.max(0, Math.cos(((i % 24) - 12) / 6)));
    const params = mkParams({ windCostPerMW: 1_200_000, solarCostPerMW: 500_000 });
    const result = optimize(windCF, solarCF, params);
    const shares = result.transparencyTable.map((r) => r.windShare);
    expect(shares.some((s) => Math.abs(s - result.bestCapacity.windShare) < 1e-9)).toBe(true);
    expect(shares.some((s) => Math.abs(s - (result.bestCost as { windShare: number }).windShare) < 1e-9)).toBe(true);
  });
});
