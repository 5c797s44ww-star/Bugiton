import Papa from 'papaparse';
import readXlsxFile from 'read-excel-file/universal';
import type { RawTable } from './types';

function isExcel(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.xlsx') ||
    name.endsWith('.xls') ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.type === 'application/vnd.ms-excel'
  );
}

async function loadCsvTable(file: File): Promise<RawTable> {
  const text = await file.text();
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true, dynamicTyping: false });
  const rows = parsed.data;
  const headers = (rows[0] ?? []).map((h) => String(h ?? '').trim());
  return { sheetName: file.name, headers, rows: rows.slice(1) };
}

async function loadExcelTables(file: File): Promise<RawTable[]> {
  const sheets = await readXlsxFile(file);
  const tables: RawTable[] = [];
  for (const { sheet, data } of sheets) {
    if (data.length === 0) continue;
    const headers = (data[0] ?? []).map((h) => String(h ?? '').trim());
    tables.push({ sheetName: sheet, headers, rows: data.slice(1) });
  }
  return tables;
}

export async function loadTables(file: File): Promise<RawTable[]> {
  if (isExcel(file)) return loadExcelTables(file);
  return [await loadCsvTable(file)];
}
