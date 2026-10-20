/** Per-database names used by the SQL formatter and the editor. */
export type FormatterLanguage = 'mysql' | 'mariadb' | 'postgresql' | 'transactsql' | 'sqlite' | 'sql';

export function formatterLanguage(engine: string | undefined): FormatterLanguage {
  switch (engine) {
    case 'mysql':
      return 'mysql';
    case 'mariadb':
      return 'mariadb';
    case 'postgresql':
      return 'postgresql';
    case 'mssql':
      return 'transactsql';
    case 'sqlite':
      return 'sqlite';
    default:
      return 'sql';
  }
}

/** Quote a table/column name for this database when it is not a plain identifier. */
export function quoteIdent(name: string, engine: string | undefined): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  if (engine === 'mysql' || engine === 'mariadb') return '`' + name.replace(/`/g, '``') + '`';
  if (engine === 'mssql') return '[' + name.replace(/]/g, ']]') + ']';
  return '"' + name.replace(/"/g, '""') + '"';
}

export const PARAM_REGEX = /\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}/g;

export function findParams(sql: string): string[] {
  const out: string[] = [];
  for (const m of sql.matchAll(PARAM_REGEX)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}
