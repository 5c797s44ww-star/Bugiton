import { useMemo, useState } from 'react';
import './App.css';
import { ParamsPanel } from './components/ParamsPanel';
import { BatteryPanel } from './components/BatteryPanel';
import { KpiTable } from './components/KpiTable';
import { BatteryKpiPanel } from './components/BatteryKpiPanel';
import { CapacityFactorChart } from './components/CapacityFactorChart';
import { HourlyChart } from './components/HourlyChart';
import { DurationCurveChart } from './components/DurationCurveChart';
import { MixTable } from './components/MixTable';
import { BatteryComparisonTable } from './components/BatteryComparisonTable';
import { DataQualityPanel } from './components/DataQualityPanel';
import { DataDetectionPanel } from './components/DataDetectionPanel';
import { SurplusDeficitPanel } from './components/SurplusDeficitPanel';
import { generateSampleData } from './lib/sampleData';
import { checkDataQuality } from './lib/dataQuality';
import { computeCapacityFactors, surplusDeficit, type CapacityFactors } from './lib/stats';
import { optimize } from './lib/optimizer';
import { optimizeWithBattery } from './lib/battery/optimize';
import { analyzeFiles, buildFromSelection } from './lib/discovery';
import type { AnalyzeResult, SeriesKind } from './lib/discovery';
import type { BatteryParams, DataQualityIssue, Params } from './lib/types';

const DEFAULT_PARAMS: Params = {
  utilization: 0.8,
  coverageTarget: 0.8,
  flexibility: 0.6,
  dcNominalPowerMW: null,
  windCostPerMW: null,
  solarCostPerMW: null,
  objective: 'capacity',
  battery: {
    durationH: 0,
    chargeEfficiency: 0.95,
    dischargeEfficiency: 0.95,
    initialSocFraction: 0.5,
  },
};

interface PendingUpload {
  files: File[];
  analysis: AnalyzeResult;
}

function App() {
  const [capacityFactors, setCapacityFactors] = useState<CapacityFactors>(() => computeCapacityFactors(generateSampleData()));
  const [dataLabel, setDataLabel] = useState('Synthetic demo data (2024, not real measurements)');
  const [qualityIssues, setQualityIssues] = useState<DataQualityIssue[]>(() => checkDataQuality(generateSampleData()));
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);

  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [selection, setSelection] = useState<Partial<Record<SeriesKind, string>>>({});
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const updateParams = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch }));
  const updateBattery = (patch: Partial<BatteryParams>) => setParams((p) => ({ ...p, battery: { ...p.battery, ...patch } }));

  const handleLoadSample = () => {
    const sample = generateSampleData();
    setCapacityFactors(computeCapacityFactors(sample));
    setDataLabel('Synthetic demo data (2024, not real measurements)');
    setQualityIssues(checkDataQuality(sample));
    setPending(null);
    setAnalysisError(null);
  };

  const runAnalysis = async (files: File[]) => {
    setAnalysisError(null);
    try {
      const analysis = await analyzeFiles(files);
      setPending({ files, analysis });
      setSelection(analysis.autoSelected);
    } catch {
      setAnalysisError(`Could not read the uploaded file(s). Make sure they're valid CSV or Excel files.`);
      setPending(null);
    }
  };

  // Files uploaded together, or added to an already-open detection panel (e.g. production and
  // capacity data uploaded as separate files), are pooled into one detection pass.
  const handleFilesSelected = (files: File[]) => {
    const combined = pending ? [...pending.files, ...files] : files;
    void runAnalysis(combined);
  };

  const preview = useMemo(() => {
    if (!pending) return null;
    return buildFromSelection(pending.analysis.candidatesByKind, selection);
  }, [pending, selection]);

  const handleSelectionChange = (kind: SeriesKind, candidateId: string) => {
    setSelection((s) => ({ ...s, [kind]: candidateId }));
  };

  const handleConfirmDetection = () => {
    if (!pending || !preview) return;
    setCapacityFactors(preview.canonical);
    const fileList = pending.files.map((f) => f.name).join(', ');
    setDataLabel(`${fileList} (${preview.canonical.timestamps.length} hours, auto-detected)`);
    setQualityIssues(preview.issues);
    setPending(null);
  };

  const handleCancelDetection = () => setPending(null);

  const isBattery = params.battery.durationH > 0;

  // Battery storage is an additive layer: with no duration selected, this is exactly the
  // original, unmodified wind/solar optimizer call - nothing about that path changes.
  const optimizationResult = useMemo(
    () =>
      isBattery
        ? optimizeWithBattery(capacityFactors.windCF, capacityFactors.solarCF, params)
        : optimize(capacityFactors.windCF, capacityFactors.solarCF, params),
    [capacityFactors, params, isBattery],
  );

  const sdStats = useMemo(
    () => surplusDeficit(optimizationResult.load, optimizationResult.re),
    [optimizationResult],
  );

  const mixTableBestCapacity = 'bestCapacity' in optimizationResult ? optimizationResult.bestCapacity : optimizationResult.best;
  const mixTableBestCost = 'bestCost' in optimizationResult ? optimizationResult.bestCost : null;
  const batteryDispatch = 'dispatch' in optimizationResult ? optimizationResult.dispatch : null;
  const batteryBest = 'batteryPowerPu' in optimizationResult.best ? optimizationResult.best : null;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Renewable Overbuild Optimizer</h1>
        <p>
          How much wind and solar capacity is required to cover a target share of a data center's electricity
          consumption, given a flexible load and a target average utilization — and how does adding battery storage
          change that answer?
        </p>
      </header>

      <div className="app-body">
        <aside className="app-sidebar">
          <ParamsPanel
            params={params}
            onChange={updateParams}
            onFilesSelected={handleFilesSelected}
            onLoadSample={handleLoadSample}
            dataInfo={dataLabel}
          />
          <BatteryPanel battery={params.battery} onChange={updateBattery} />
          {analysisError && <p className="warning-banner">{analysisError}</p>}
          {pending ? (
            <DataDetectionPanel
              analysis={pending.analysis}
              selection={selection}
              preview={preview}
              onSelectionChange={handleSelectionChange}
              onConfirm={handleConfirmDetection}
              onCancel={handleCancelDetection}
            />
          ) : (
            <DataQualityPanel issues={qualityIssues} />
          )}
        </aside>

        <main className="app-main">
          <KpiTable params={params} best={optimizationResult.best} load={optimizationResult.load} />
          {batteryBest && batteryDispatch && <BatteryKpiPanel params={params} best={batteryBest} dispatch={batteryDispatch} />}
          <CapacityFactorChart
            timestamps={capacityFactors.timestamps}
            windCF={capacityFactors.windCF}
            solarCF={capacityFactors.solarCF}
          />
          <HourlyChart
            timestamps={capacityFactors.timestamps}
            wind={optimizationResult.wind}
            solar={optimizationResult.solar}
            load={optimizationResult.load}
            lowerBand={optimizationResult.lowerBand}
            upperBand={optimizationResult.upperBand}
            charge={batteryDispatch?.charge}
            discharge={batteryDispatch?.discharge}
            soc={batteryDispatch?.soc}
            batteryEnergyPuH={batteryBest?.batteryEnergyPuH}
          />
          <DurationCurveChart re={optimizationResult.re} />
          <MixTable rows={optimizationResult.transparencyTable} bestCapacity={mixTableBestCapacity} bestCost={mixTableBestCost} />
          <BatteryComparisonTable windCF={capacityFactors.windCF} solarCF={capacityFactors.solarCF} params={params} />
          <SurplusDeficitPanel stats={sdStats} />
        </main>
      </div>
    </div>
  );
}

export default App;
