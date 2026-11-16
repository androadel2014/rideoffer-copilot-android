import { formatPerHour, formatPerMile } from '../engine/grading';
import { formatDistance, formatMoney, formatNumber, US_FORMAT, type MoneyFormat } from '../engine/market';

/**
 * Display helpers. Every money/distance helper takes an optional MoneyFormat (currency,
 * mi/km, decimal comma); without one it shows US dollars and miles exactly as before.
 * Distances passed in are always MILES (canonical) and rates are per mile.
 */
export const fmtMoney = (n: number | null | undefined, f: MoneyFormat = US_FORMAT) => formatMoney(n, f);

/** Same formatting as the overlay: "$36/hr" and "68¢/mi" (dollars from $1.00/mi up), "€0,44/km". */
export const fmtPerMile = (n: number | null | undefined, f: MoneyFormat = US_FORMAT) => formatPerMile(n ?? null, f);
export const fmtPerHour = (n: number | null | undefined, f: MoneyFormat = US_FORMAT) => formatPerHour(n ?? null, f);
export const fmtMi = (n: number | null | undefined, f: Pick<MoneyFormat, 'unit' | 'decimalComma'> = US_FORMAT) => formatDistance(n, f);
export const fmtMin = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n)} min`);
export const fmtRating = (n: number | null | undefined, f: Pick<MoneyFormat, 'decimalComma'> = US_FORMAT) =>
  n == null ? '—' : formatNumber(n, 2, f);

export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(r).padStart(2, '0')}s`;
  return `${r}s`;
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(r).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

export function fmtDay(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, y)) return 'Yesterday';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
}

export function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const platformLabel = (p: string) => (p === 'uber' ? 'Uber' : p === 'lyft' ? 'Lyft' : 'Unknown app');
