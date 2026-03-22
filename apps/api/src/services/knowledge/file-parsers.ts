import type { ParsedTable } from './types';

export async function parsePdf(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pdf-parse');
  const pdfParse = (typeof mod === 'function' ? mod : mod.default) as (buf: Buffer) => Promise<{ text: string }>;
  const result = await pdfParse(buffer);
  return result.text.trim();
}

export async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

export function parseTxt(buffer: Buffer): string {
  return buffer.toString('utf-8').trim();
}

export async function parseCsv(buffer: Buffer): Promise<ParsedTable> {
  const { parse } = await import('csv-parse/sync');
  const records = parse(buffer, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  if (records.length === 0) return { headers: [], rows: [] };
  const headers = Object.keys(records[0]);
  return { headers, rows: records };
}

export function parseXlsx(buffer: Buffer): ParsedTable {
  const XLSX = require('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[];
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = Object.keys(rows[0]).map(String);
  const stringRows = rows.map((r) => {
    const mapped: Record<string, string> = {};
    for (const key of headers) mapped[key] = String(r[key] ?? '');
    return mapped;
  });
  return { headers, rows: stringRows };
}

export function detectDocType(filename: string): 'text' | 'table' {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'csv' || ext === 'xlsx' || ext === 'xls' ? 'table' : 'text';
}
