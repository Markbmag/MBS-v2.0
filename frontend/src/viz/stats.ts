/**
 * Chart overlays (roadmap M7): a straight trend line and a simple forecast that
 * continues it. Least squares over the points in order (gaps are skipped, not
 * zero). Deliberately simple: the chart says "trend", not "prediction".
 * Pure functions, unit-tested in tests/viz.test.ts.
 */

export interface Fit {
  slope: number;
  intercept: number;
  r2: number;
}

/** Least-squares line through (index, value); null with fewer than 2 values. */
export function linearFit(values: (number | null)[]): Fit | null {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null && Number.isFinite(p[1]));
  if (pts.length < 2) return null;
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n;
  const my = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pts) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2 };
}

/** The trend at every index, plus `ahead` more points (the forecast). */
export function trendValues(values: (number | null)[], ahead = 0): number[] | null {
  const fit = linearFit(values);
  if (!fit) return null;
  return Array.from({ length: values.length + ahead }, (_, i) => round(fit.intercept + fit.slope * i));
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

const DAY = 86_400_000;

function parseDay(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The next `n` dates after a sorted list of ISO dates, with the list's own step:
 * days, weeks, calendar months, quarters or years. Null when the values are not dates.
 */
export function nextDates(raw: string[], n: number): string[] | null {
  const days = raw.map(parseDay);
  if (days.length < 2 || days.some((d) => d === null)) return null;
  const ds = days as Date[];
  const gaps = ds.slice(1).map((d, i) => Math.round((d.getTime() - ds[i].getTime()) / DAY)).sort((a, b) => a - b);
  const step = gaps[Math.floor(gaps.length / 2)];
  const last = ds[ds.length - 1];
  const out: string[] = [];
  for (let k = 1; k <= n; k++) {
    if (step >= 28) {
      const months = step >= 360 ? 12 : step >= 89 ? 3 : 1;
      out.push(iso(new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + months * k, last.getUTCDate()))));
    } else {
      out.push(iso(new Date(last.getTime() + Math.max(step, 1) * k * DAY)));
    }
  }
  return out;
}
