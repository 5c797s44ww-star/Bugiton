import { useMemo, useState } from 'react';
import './App.css';
import { ParamsPanel } from './components/ParamsPanel';
import { KpiTable } from './components/KpiTable';
import { HourlyChart } from './components/HourlyChart';
import { DurationCurveChart } from './components/DurationCurveChart';
import { MixTable } from './components/MixTable';
import { DataQualityPanel } from './components/DataQualityPanel';
import { SurplusDeficitPanel } from './components/SurplusDeficitPanel';
import { generateSampleData } from './lib/sampleData';
import { parseCsv } from './lib/csv';
import { checkDataQuality } from './lib/dataQuality';
import { computeCapacityFactors, surplusDeficit } from './lib/stats';
import { optimize } from './lib/optimizer';
import type { DataQualityIssue, HourlyRecord, Params } from './lib/types';

const DEFAULT_PARAMS: Params = {
  utilization: 0.8,
  coverageTarget: 0.8,
  flexibility: 0.6,
  dcNominalPowerMW: null,
  windCostPerMW: null,
  solarCostPerMW: null,
  objective: 'capacity',
};

function App() {
  const [records, setRecords] = useState<HourlyRecord[]>(() => generateSampleData());
  const [dataLabel, setDataLabel] = useState('Synthetic demo data (2024, not real measurements)');
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);

  const updateParams = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch }));

  const handleLoadSample = () => {
    setRecords(generateSampleData());
    setDataLabel('Synthetic demo data (2024, not real measurements)');
    setParseErrors([]);
  };

  const handleFileSelected = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const { records: parsed, errors } = parseCsv(text);
      if (parsed.length === 0) {
        setParseErrors(errors.length > 0 ? errors : ['No valid rows could be parsed from this file.']);
        return;
      }
      setRecords(parsed);
      setDataLabel(`${file.name} (${parsed.length} hours)`);
      setParseErrors(errors);
    };
    reader.readAsText(file);
  };

  const capacityFactors = useMemo(() => computeCapacityFactors(records), [records]);
  const dqIssues = useMemo((): DataQualityIssue[] => {
    const parseIssues: DataQualityIssue[] = parseErrors.map((message) => ({
      type: 'csv-parse',
      severity: 'error',
      message,
    }));
    return [...parseIssues, ...checkDataQuality(records)];
  }, [records, parseErrors]);

  const optimizationResult = useMemo(
    () => optimize(capacityFactors.windCF, capacityFactors.solarCF, params),
    [capacityFactors, params],
  );

  const sdStats = useMemo(
    () => surplusDeficit(optimizationResult.load, optimizationResult.re),
    [optimizationResult],
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>Renewable Overbuild Optimizer</h1>
        <p>
          How much wind and solar capacity is required to cover a target share of a data center's electricity
          consumption, given a flexible load and a target average utilization?
        </p>
      </header>

      <div className="app-body">
        <aside className="app-sidebar">
          <ParamsPanel
            params={params}
            onChange={updateParams}
            onFileSelected={handleFileSelected}
            onLoadSample={handleLoadSample}
            dataInfo={dataLabel}
          />
          <DataQualityPanel issues={dqIssues} />
        </aside>

        <main className="app-main">
          <KpiTable params={params} best={optimizationResult.best} load={optimizationResult.load} />
          <HourlyChart
            timestamps={capacityFactors.timestamps}
            wind={optimizationResult.wind}
            solar={optimizationResult.solar}
            load={optimizationResult.load}
            lowerBand={optimizationResult.lowerBand}
            upperBand={optimizationResult.upperBand}
          />
          <DurationCurveChart re={optimizationResult.re} />
          <MixTable
            rows={optimizationResult.transparencyTable}
            bestCapacity={optimizationResult.bestCapacity}
            bestCost={optimizationResult.bestCost}
          />
          <SurplusDeficitPanel stats={sdStats} />
        </main>
      </div>
    </div>
  );
}

export default App;
