import type { Relationship } from '../api';

/** One join the backend will add: `table` joined on (column in the query, column of `table`) pairs. */
export interface JoinStep {
  table: string;
  on: [string, string][];
}

/**
 * Shortest chain of foreign keys from `start` to `target` (both directions), the
 * same search the backend runs (app/schema_graph.find_join_path). [] when start ===
 * target, null when they are not connected within maxHops.
 */
export function findJoinPath(rels: Relationship[], start: string, target: string, maxHops = 4): JoinStep[] | null {
  if (start === target) return [];
  const adjacency = new Map<string, { to: string; step: JoinStep }[]>();
  const add = (from: string, to: string, step: JoinStep) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from)!.push({ to, step });
  };
  for (const r of rels) {
    const pairs = r.from_columns.map((c, i) => [c, r.to_columns[i]] as const);
    add(r.from_table, r.to_table, { table: r.to_table, on: pairs.map(([a, b]) => [`${r.from_table}.${a}`, `${r.to_table}.${b}`]) });
    add(r.to_table, r.from_table, { table: r.from_table, on: pairs.map(([a, b]) => [`${r.to_table}.${b}`, `${r.from_table}.${a}`]) });
  }
  for (const edges of adjacency.values()) {
    edges.sort((x, y) => (x.to === y.to ? JSON.stringify(x.step.on).localeCompare(JSON.stringify(y.step.on)) : x.to < y.to ? -1 : 1));
  }
  const queue: { table: string; path: JoinStep[] }[] = [{ table: start, path: [] }];
  const seen = new Set([start]);
  while (queue.length > 0) {
    const { table, path } = queue.shift()!;
    if (path.length >= maxHops) continue;
    for (const { to, step } of adjacency.get(table) ?? []) {
      if (seen.has(to)) continue;
      if (to === target) return [...path, step];
      seen.add(to);
      queue.push({ table: to, path: [...path, step] });
    }
  }
  return null;
}

/** Best path from any of the tables already in the question (fewest hops). */
export function bestPath(rels: Relationship[], fromTables: string[], target: string): { from: string; path: JoinStep[] } | null {
  let best: { from: string; path: JoinStep[] } | null = null;
  for (const from of fromTables) {
    const path = findJoinPath(rels, from, target);
    if (path && path.length > 0 && (!best || path.length < best.path.length)) best = { from, path };
  }
  return best;
}

/** Tables that can be joined automatically, with the tables passed through ("via"). */
export function joinSuggestions(
  rels: Relationship[],
  allTables: string[],
  inQuery: string[],
): { table: string; via: string[]; hops: number }[] {
  const out = [];
  for (const table of allTables) {
    if (inQuery.includes(table)) continue;
    const best = bestPath(rels, inQuery, table);
    if (best) out.push({ table, via: best.path.slice(0, -1).map((s) => s.table), hops: best.path.length });
  }
  return out.sort((a, b) => a.hops - b.hops || a.table.localeCompare(b.table));
}
