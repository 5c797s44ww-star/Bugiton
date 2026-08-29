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

export interface Params {
  utilization: number; // 0..1
  coverageTarget: number; // 0..1
  flexibility: number; // 0..1
  dcNominalPowerMW: number | null;
  windCostPerMW: number | null;
  solarCostPerMW: number | null;
  objective: 'capacity' | 'cost';
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
