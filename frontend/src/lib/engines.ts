import { t } from '../i18n/index.ts';
export interface EngineMeta {
  label: string;
  short: string;
  color: string;
  blurb: string;
}

const META: Record<string, EngineMeta> = {
  mysql: { label: 'MySQL', short: 'My', color: '#0e7490', blurb: t('The most popular open-source database') },
  mariadb: { label: 'MariaDB', short: 'Ma', color: '#a8553b', blurb: t('MySQL-compatible fork') },
  postgresql: { label: 'PostgreSQL', short: 'Pg', color: '#2f5f95', blurb: t('Advanced open-source relational database') },
  mssql: { label: 'SQL Server', short: 'Ms', color: '#b91c1c', blurb: t("Microsoft's relational database") },
  sqlite: { label: 'SQLite', short: 'Sq', color: '#0f80cc', blurb: t('A database file on the server') },
};

export function engineMeta(name: string): EngineMeta {
  return META[name] ?? { label: name, short: name.slice(0, 2).toUpperCase(), color: '#64748b', blurb: '' };
}
