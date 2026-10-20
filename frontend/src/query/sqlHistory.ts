import { loadJson, saveJson } from '../lib/storage';

export interface HistoryEntry {
  connection: string;
  sql: string;
  at: number;
}

const KEY = 'ncode_sql_history';
const MAX = 50;

/** Queries run in this browser (newest first). Never leaves the browser. */
export function loadHistory(connection: string): HistoryEntry[] {
  return loadJson<HistoryEntry[]>(KEY, []).filter((e) => e.connection === connection);
}

export function addHistory(connection: string, sql: string): void {
  const text = sql.trim();
  if (!text) return;
  const all = loadJson<HistoryEntry[]>(KEY, []).filter((e) => !(e.connection === connection && e.sql === text));
  saveJson(KEY, [{ connection, sql: text, at: Date.now() }, ...all].slice(0, MAX));
}
