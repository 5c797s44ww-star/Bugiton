import { describe, expect, it } from 'vitest';
import { simulateBatteryDispatch } from './dispatch';

describe('simulateBatteryDispatch', () => {
  it('never exceeds power capacity for charge or discharge', () => {
    const n = 48;
    const load = new Float64Array(n).fill(0.5);
    const re = new Float64Array(n);
    for (let t = 0; t < n; t++) re[t] = t % 2 === 0 ? 1.0 : 0.0; // alternating big surplus/deficit
    const result = simulateBatteryDispatch(load, re, 0.2, 0.2 * 4, 0.95, 0.95, 0.5);
    for (let t = 0; t < n; t++) {
      expect(result.charge[t]).toBeLessThanOrEqual(0.2 + 1e-9);
      expect(result.discharge[t]).toBeLessThanOrEqual(0.2 + 1e-9);
    }
  });

  it('never charges and discharges in the same hour', () => {
    const n = 100;
    const load = new Float64Array(n).map(() => Math.random());
    const re = new Float64Array(n).map(() => Math.random());
    const result = simulateBatteryDispatch(load, re, 0.5, 2.0, 0.95, 0.95, 0.5);
    for (let t = 0; t < n; t++) {
      expect(result.charge[t] * result.discharge[t]).toBe(0);
    }
  });

  it('keeps state of charge within [0, energy capacity]', () => {
    const n = 240;
    const load = new Float64Array(n).fill(0.6);
    const re = new Float64Array(n);
    for (let t = 0; t < n; t++) re[t] = Math.max(0, Math.sin((t % 24) / 24 * 2 * Math.PI) * 0.9 + 0.1);
    const E = 1.6;
    const result = simulateBatteryDispatch(load, re, 0.4, E, 0.95, 0.95, 0.5);
    for (let t = 0; t < n; t++) {
      expect(result.soc[t]).toBeGreaterThanOrEqual(-1e-9);
      expect(result.soc[t]).toBeLessThanOrEqual(E + 1e-9);
    }
    expect(result.maxSoc).toBeLessThanOrEqual(E + 1e-9);
  });

  it('converges to a periodic steady state for a periodic input (cyclic SOC)', () => {
    // A daily-repeating pattern, run for 10 days: after warm-up, each day's ending SOC should
    // match every other day's ending SOC (the trajectory has become periodic), which is a
    // stronger, directly-observable form of "SOC[end of period] = SOC[start of period]".
    const days = 10;
    const n = days * 24;
    const load = new Float64Array(n);
    const re = new Float64Array(n);
    for (let t = 0; t < n; t++) {
      const h = t % 24;
      load[t] = 0.5;
      re[t] = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI)) * 0.8; // solar-like daily bump
    }
    const result = simulateBatteryDispatch(load, re, 0.3, 1.2, 0.95, 0.95, 0.5);
    const endOfDaySoc = Array.from({ length: days }, (_, d) => result.soc[d * 24 + 23]);
    // Later days should have converged to (nearly) the same end-of-day SOC.
    const last = endOfDaySoc[days - 1];
    const secondLast = endOfDaySoc[days - 2];
    expect(Math.abs(last - secondLast)).toBeLessThan(1e-6);
  });

  it('applies round-trip efficiency: less energy is delivered back than was stored', () => {
    // One big surplus hour charges the battery fully, then one big deficit hour drains it.
    const load = new Float64Array([0, 1]);
    const re = new Float64Array([1, 0]);
    const chargeEff = 0.95;
    const dischargeEff = 0.95;
    const result = simulateBatteryDispatch(load, re, 1, 1, chargeEff, dischargeEff, 0);
    // Charge stage: surplus=1, limited by energy headroom (E=1, start soc=0) -> charge = 1/0.95? no:
    // charge <= min(surplus=1, P=1, (E-0)/chargeEff=1/0.95=1.0526) -> charge=1.
    expect(result.charge[0]).toBeCloseTo(1, 6);
    // Stored energy = charge * chargeEff = 0.95.
    // Discharge stage: deficit=1, available = soc*dischargeEff = 0.95*0.95=0.9025, power cap 1.
    expect(result.discharge[1]).toBeCloseTo(0.95 * dischargeEff, 6);
    expect(result.discharge[1]).toBeLessThan(result.charge[0]); // round-trip loss is real
  });

  it('excludes charging losses from delivered/coverage energy (only actual discharge counts)', () => {
    const load = new Float64Array([0, 1]);
    const re = new Float64Array([1, 0]);
    const result = simulateBatteryDispatch(load, re, 1, 1, 0.95, 0.95, 0);
    // Hour 0: load=0, so nothing is "delivered" (direct min(re,load)=0) even though the battery charges.
    expect(result.delivered[0]).toBeCloseTo(0, 9);
    // Hour 1: delivered = direct(0) + discharge.
    expect(result.delivered[1]).toBeCloseTo(result.discharge[1], 9);
    expect(result.coveredEnergy).toBeCloseTo(result.discharge[1], 9);
    // Coverage must be strictly less than 100% because of round-trip losses (can't fully cover
    // hour 1's load of 1 from only 1 unit of hour-0 surplus once losses are accounted for).
    expect(result.coverageFraction).toBeLessThan(1);
  });

  it('never creates energy: total delivered + curtailed + other-source-gap is consistent with conservation', () => {
    const n = 72;
    const load = new Float64Array(n).map(() => 0.3 + Math.random() * 0.4);
    const re = new Float64Array(n).map(() => Math.random());
    const result = simulateBatteryDispatch(load, re, 0.3, 1.2, 0.9, 0.9, 0.5);
    for (let t = 0; t < n; t++) {
      const surplus = Math.max(re[t] - load[t], 0);
      const deficit = Math.max(load[t] - re[t], 0);
      // curtailed + charge accounts for all surplus; other-source + discharge accounts for all deficit.
      expect(result.curtailed[t] + result.charge[t]).toBeCloseTo(surplus, 9);
      expect(result.otherSource[t] + result.discharge[t]).toBeCloseTo(deficit, 9);
      // Delivered can never exceed what the DC actually demanded.
      expect(result.delivered[t]).toBeLessThanOrEqual(load[t] + 1e-9);
    }
  });

  it('degenerates to no battery effect when power or energy capacity is zero', () => {
    const n = 24;
    const load = new Float64Array(n).fill(0.5);
    const re = new Float64Array(n).map((_, t) => (t < 12 ? 0.9 : 0.1));
    const zeroPower = simulateBatteryDispatch(load, re, 0, 4, 0.95, 0.95, 0.5);
    const zeroEnergy = simulateBatteryDispatch(load, re, 0.5, 0, 0.95, 0.95, 0.5);
    for (let t = 0; t < n; t++) {
      expect(zeroPower.charge[t]).toBe(0);
      expect(zeroPower.discharge[t]).toBe(0);
      expect(zeroEnergy.charge[t]).toBe(0);
      expect(zeroEnergy.discharge[t]).toBe(0);
    }
    // With no battery, delivered should equal direct min(re, load) exactly.
    for (let t = 0; t < n; t++) {
      expect(zeroPower.delivered[t]).toBeCloseTo(Math.min(re[t], load[t]), 9);
    }
  });
});
