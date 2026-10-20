import { format } from 'sql-formatter';
import { formatterLanguage } from './dialect';

/** Readable SQL ({{params}} kept as they are). Unusual syntax is returned unchanged. */
export function prettySql(sql: string, engine: string | undefined): string {
  try {
    return format(sql, {
      language: formatterLanguage(engine),
      keywordCase: 'upper',
      tabWidth: 2,
      paramTypes: { custom: [{ regex: String.raw`\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}` }] },
    });
  } catch {
    return sql;
  }
}
