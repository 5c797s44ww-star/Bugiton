export interface HourlyRecord {
  timestamp: Date;
  windGeneration: number;
  solarGeneration: number;
  windCapacity: number;
  solarCapacity: number;
}

export interface HourlyCF {
  timestamp: Date;
  windCF: number;
  solarCF: number;
}

/** 0 = no battery. Duration sets energy capacity as a multiple of power capacity (E = P x duration). */
export type BatteryDurationH = 0 | 2 | 4 | 8;

export interface BatteryParams {
  durationH: BatteryDurationH;
  chargeEfficiency: number; // 0..1, default 0.95
  dischargeEfficiency: number; // 0..1, default 0.95 (round-trip ~= charge x discharge)
  initialSocFraction: number; // 0..1, fraction of energy capacity at simulation start, default 0.5
}

export interface Params {
  utilization: number; // 0..1
  coverageTarget: number; // 0..1
  flexibility: number; // 0..1
  dcNominalPowerMW: number | null;
  windCostPerMW: number | null;
  solarCostPerMW: number | null;
  objective: 'capacity' | 'cost';
  battery: BatteryParams;
}

export interface MixPoint {
  windShare: number; // 0..1
  solarShare: number;
  windCapacityPu: number;
  solarCapacityPu: number;
  totalOverbuildPu: number;
  totalCost: number | null;
  achievedCoverage: number;
  feasible: boolean;
}

export interface LoadAllocationResult {
  load: Float64Array; // pu, per hour
  coveredEnergy: number; // pu*h
  totalDcEnergy: number; // pu*h
  coverageFraction: number;
}

export interface OptimizationResult {
  best: MixPoint; // selected per params.objective, drives the main chart/KPIs
  bestCapacity: MixPoint; // capacity-optimal mix (always computed)
  bestCost: MixPoint | null; // cost-optimal mix, only when cost params are given
  scan: MixPoint[]; // fine-resolution scan used internally
  transparencyTable: MixPoint[]; // coarse table for display
  load: Float64Array;
  re: Float64Array; // total RE[t] at the best mix's capacities
  wind: Float64Array;
  solar: Float64Array;
  lowerBand: number;
  upperBand: number;
}

export interface DataQualityIssue {
  type: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  count?: number;
}

export interface SurplusDeficitStats {
  annualRenewableGeneration: number;
  annualSurplus: number;
  annualDeficit: number;
  hoursWithSurplus: number;
  hoursWithDeficit: number;
  maxSurplus: number;
  maxDeficit: number;
}

/**
 * Battery dispatch outputs for one fixed (load[], re[], battery config) combination - see
 * src/lib/battery/dispatch.ts. Renewable coverage here counts only energy actually delivered
 * to the DC (direct + battery discharge), never energy lost to charging/round-trip losses.
 */
export interface BatteryDispatchResult {
  soc: Float64Array; // pu*h, end-of-hour state of charge
  charge: Float64Array; // pu, power drawn from surplus into the battery
  discharge: Float64Array; // pu, power delivered from the battery to the DC
  delivered: Float64Array; // pu, renewable energy delivered to the DC this hour (direct + discharge)
  curtailed: Float64Array; // pu, surplus renewable neither used directly nor absorbed by the battery
  otherSource: Float64Array; // pu, DC demand covered by neither renewables nor the battery
  coveredEnergy: number; // pu*h, sum(delivered)
  curtailedEnergy: number; // pu*h, sum(curtailed)
  otherSourceEnergy: number; // pu*h, sum(otherSource)
  totalDcEnergy: number; // pu*h
  coverageFraction: number;
  maxSoc: number; // pu*h
  cycles: number; // equivalent full cycles over the period, based on discharged throughput
}

export interface BatteryMixPoint extends MixPoint {
  batteryPowerPu: number;
  batteryEnergyPuH: number;
  /** wind + solar + battery power (pu). `totalOverbuildPu` (from MixPoint) stays wind+solar only. */
  totalSystemCapacityPu: number;
}

export interface BatteryOptimizationResult {
  best: BatteryMixPoint;
  scan: BatteryMixPoint[];
  transparencyTable: BatteryMixPoint[];
  load: Float64Array;
  re: Float64Array;
  wind: Float64Array;
  solar: Float64Array;
  dispatch: BatteryDispatchResult;
  lowerBand: number;
  upperBand: number;
}
