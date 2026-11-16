// Markets, currencies and distance units. Pure TypeScript (unit-tested in Node).
//
// Canonical internal units
// ------------------------
// Every distance the parser reads is converted to MILES, and every rate the grader
// computes is per MILE, in the offer's own currency. That keeps the database columns
// (pickup_mi, net_per_mile, …) and the grading math unchanged for every market.
// Conversion to kilometres happens only at the edges: when a market's settings are
// turned into grading thresholds (gradingFor) and when a number is shown on screen
// (formatPerDistance, formatDistance).

export type DistanceUnit = 'mi' | 'km';
export const KM_PER_MI = 1.609344;

export type CurrencyCode =
  | 'USD' | 'CAD' | 'AUD' | 'NZD' | 'MXN' | 'BRL' | 'EUR' | 'GBP' | 'CHF' | 'PLN' | 'TRY'
  | 'INR' | 'AED' | 'SAR' | 'QAR' | 'KWD' | 'JOD' | 'EGP' | 'ZAR' | 'NGN' | 'KES' | 'JPY';

export interface CurrencyDef {
  code: CurrencyCode;
  /** Symbol used on screen. */
  symbol: string;
  /** Symbol goes after the amount ("12,50 zł") instead of before it ("€12.50"). */
  suffix?: boolean;
  /** Sub-unit used for small per-distance rates, like "68¢/mi" or "45p/mi". */
  minor?: string;
  /** Digits after the decimal point for money amounts. */
  decimals: number;
  /**
   * Approximate units per 1 USD. Used ONLY to seed a market's default thresholds and to
   * scale the parser's plausibility range for fares. Every threshold stays editable.
   */
  perUsd: number;
  /** Tokens that identify this currency in offer text. A bare "$" is resolved separately. */
  tokens: string[];
  /** Uses a bare "$" on offer cards. */
  dollar?: boolean;
}

export const CURRENCIES: Record<CurrencyCode, CurrencyDef> = {
  USD: { code: 'USD', symbol: '$', minor: '¢', decimals: 2, perUsd: 1, tokens: ['US$', 'USD'], dollar: true },
  CAD: { code: 'CAD', symbol: '$', minor: '¢', decimals: 2, perUsd: 1.38, tokens: ['CA$', 'C$', 'CAD'], dollar: true },
  AUD: { code: 'AUD', symbol: '$', minor: 'c', decimals: 2, perUsd: 1.53, tokens: ['AU$', 'A$', 'AUD'], dollar: true },
  NZD: { code: 'NZD', symbol: '$', minor: 'c', decimals: 2, perUsd: 1.7, tokens: ['NZ$', 'NZD'], dollar: true },
  MXN: { code: 'MXN', symbol: '$', decimals: 2, perUsd: 18.5, tokens: ['MX$', 'MXN'], dollar: true },
  BRL: { code: 'BRL', symbol: 'R$', decimals: 2, perUsd: 5.4, tokens: ['R$', 'BRL'] },
  EUR: { code: 'EUR', symbol: '€', minor: 'c', decimals: 2, perUsd: 0.86, tokens: ['€', 'EUR'] },
  GBP: { code: 'GBP', symbol: '£', minor: 'p', decimals: 2, perUsd: 0.75, tokens: ['£', 'GBP'] },
  CHF: { code: 'CHF', symbol: 'CHF ', decimals: 2, perUsd: 0.8, tokens: ['CHF'] },
  PLN: { code: 'PLN', symbol: ' zł', suffix: true, decimals: 2, perUsd: 3.65, tokens: ['zł', 'PLN'] },
  TRY: { code: 'TRY', symbol: '₺', decimals: 2, perUsd: 42, tokens: ['₺', 'TRY', 'TL'] },
  INR: { code: 'INR', symbol: '₹', decimals: 2, perUsd: 88, tokens: ['₹', 'INR', 'Rs.', 'Rs'] },
  AED: { code: 'AED', symbol: 'AED ', decimals: 2, perUsd: 3.6725, tokens: ['AED', 'د.إ', 'Dhs', 'DHS'] },
  SAR: { code: 'SAR', symbol: 'SAR ', decimals: 2, perUsd: 3.75, tokens: ['SAR', 'ر.س', '﷼', 'SR'] },
  QAR: { code: 'QAR', symbol: 'QAR ', decimals: 2, perUsd: 3.64, tokens: ['QAR', 'ر.ق', 'QR'] },
  KWD: { code: 'KWD', symbol: 'KD ', decimals: 3, perUsd: 0.306, tokens: ['KWD', 'د.ك', 'KD'] },
  JOD: { code: 'JOD', symbol: 'JD ', decimals: 3, perUsd: 0.709, tokens: ['JOD', 'د.أ', 'JD'] },
  EGP: { code: 'EGP', symbol: 'E£', decimals: 2, perUsd: 47.5, tokens: ['EGP', 'E£', 'L.E.', 'L.E', 'LE', 'ج.م', 'جنيه'] },
  ZAR: { code: 'ZAR', symbol: 'R', decimals: 2, perUsd: 17.5, tokens: ['ZAR'] },
  NGN: { code: 'NGN', symbol: '₦', decimals: 2, perUsd: 1500, tokens: ['₦', 'NGN'] },
  KES: { code: 'KES', symbol: 'KSh ', decimals: 2, perUsd: 129, tokens: ['KSh', 'Ksh', 'KES'] },
  JPY: { code: 'JPY', symbol: '¥', decimals: 0, perUsd: 150, tokens: ['¥', 'JPY', '円'] },
};

export type MarketCode =
  | 'US' | 'CA' | 'GB' | 'IE' | 'EU' | 'AU' | 'NZ' | 'MX' | 'BR' | 'CH' | 'PL' | 'TR'
  | 'IN' | 'AE' | 'SA' | 'QA' | 'KW' | 'JO' | 'EG' | 'ZA' | 'NG' | 'KE' | 'JP';

export interface MarketDef {
  code: MarketCode;
  name: string;
  currency: CurrencyCode;
  unit: DistanceUnit;
  /** Show "0,71" instead of "0.71" on screen. Parsing accepts both everywhere. */
  decimalComma: boolean;
}

export const MARKETS: MarketDef[] = [
  { code: 'US', name: 'United States', currency: 'USD', unit: 'mi', decimalComma: false },
  { code: 'CA', name: 'Canada', currency: 'CAD', unit: 'km', decimalComma: false },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', unit: 'mi', decimalComma: false },
  { code: 'EU', name: 'Eurozone (DE, FR, NL, ES, IT…)', currency: 'EUR', unit: 'km', decimalComma: true },
  { code: 'IE', name: 'Ireland', currency: 'EUR', unit: 'km', decimalComma: false },
  { code: 'AU', name: 'Australia', currency: 'AUD', unit: 'km', decimalComma: false },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD', unit: 'km', decimalComma: false },
  { code: 'MX', name: 'Mexico', currency: 'MXN', unit: 'km', decimalComma: false },
  { code: 'BR', name: 'Brazil', currency: 'BRL', unit: 'km', decimalComma: true },
  { code: 'CH', name: 'Switzerland', currency: 'CHF', unit: 'km', decimalComma: false },
  { code: 'PL', name: 'Poland', currency: 'PLN', unit: 'km', decimalComma: true },
  { code: 'TR', name: 'Türkiye', currency: 'TRY', unit: 'km', decimalComma: true },
  { code: 'IN', name: 'India', currency: 'INR', unit: 'km', decimalComma: false },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', unit: 'km', decimalComma: false },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', unit: 'km', decimalComma: false },
  { code: 'QA', name: 'Qatar', currency: 'QAR', unit: 'km', decimalComma: false },
  { code: 'KW', name: 'Kuwait', currency: 'KWD', unit: 'km', decimalComma: false },
  { code: 'JO', name: 'Jordan', currency: 'JOD', unit: 'km', decimalComma: false },
  { code: 'EG', name: 'Egypt', currency: 'EGP', unit: 'km', decimalComma: false },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', unit: 'km', decimalComma: false },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', unit: 'km', decimalComma: false },
  { code: 'KE', name: 'Kenya', currency: 'KES', unit: 'km', decimalComma: false },
  { code: 'JP', name: 'Japan', currency: 'JPY', unit: 'km', decimalComma: false },
];

const MARKET_BY_CODE = new Map(MARKETS.map((m) => [m.code, m]));

export function isMarketCode(v: unknown): v is MarketCode {
  return typeof v === 'string' && MARKET_BY_CODE.has(v as MarketCode);
}
export function isCurrencyCode(v: unknown): v is CurrencyCode {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CURRENCIES, v);
}

export function getMarket(code: MarketCode | string | null | undefined): MarketDef {
  return MARKET_BY_CODE.get(code as MarketCode) ?? MARKETS[0];
}

// ---------------------------------------------------------------------------------------
// Per-market settings
// ---------------------------------------------------------------------------------------

/** User-editable money settings for one market, in that market's currency and distance unit. */
export interface MarketProfile {
  /** Vehicle cost per km (or per mile in mile markets). */
  costPerUnit: number;
  greatMinNetPerUnit: number;
  greatMinNetPerHour: number;
  badBelowNetPerUnit: number;
  badBelowNetPerHour: number;
}

/** The US defaults every other market's defaults are converted from. */
export const US_PROFILE: MarketProfile = {
  costPerUnit: 0.3,
  greatMinNetPerUnit: 1.25,
  greatMinNetPerHour: 30,
  badBelowNetPerUnit: 0.8,
  badBelowNetPerHour: 18,
};

/** Two significant figures, so converted defaults read like numbers a person would pick. */
export function niceRound(x: number): number {
  if (!Number.isFinite(x) || x === 0) return 0;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(x))) - 1);
  return Math.round(Math.round(x / mag) * mag * 1e6) / 1e6;
}

/**
 * Default thresholds for a market: the US defaults (GREAT ≥ $1.25/mi and ≥ $30/hr,
 * BAD < $0.80/mi or < $18/hr, cost $0.30/mi) converted to the market's currency and
 * distance unit. The US market keeps the exact numbers.
 */
export function defaultProfile(code: MarketCode): MarketProfile {
  const m = getMarket(code);
  if (m.code === 'US') return { ...US_PROFILE };
  const fx = CURRENCIES[m.currency].perUsd;
  const perUnit = (usdPerMile: number) => niceRound((m.unit === 'km' ? usdPerMile / KM_PER_MI : usdPerMile) * fx);
  return {
    costPerUnit: perUnit(US_PROFILE.costPerUnit),
    greatMinNetPerUnit: perUnit(US_PROFILE.greatMinNetPerUnit),
    greatMinNetPerHour: niceRound(US_PROFILE.greatMinNetPerHour * fx),
    badBelowNetPerUnit: perUnit(US_PROFILE.badBelowNetPerUnit),
    badBelowNetPerHour: niceRound(US_PROFILE.badBelowNetPerHour * fx),
  };
}

export interface MarketSettings {
  /** The market you drive in. Its currency and unit are used unless a card says otherwise. */
  home: MarketCode;
  /** Grade a card shown in another currency with that currency's market settings. */
  autoDetect: boolean;
  /** Only markets the user has edited are stored; the rest use defaultProfile(). */
  profiles: Partial<Record<MarketCode, MarketProfile>>;
}

export const DEFAULT_MARKET_SETTINGS: MarketSettings = { home: 'US', autoDetect: true, profiles: {} };

export function profileFor(ms: MarketSettings, code: MarketCode): MarketProfile {
  return ms.profiles[code] ?? defaultProfile(code);
}

/** The currency a bare "$" means: the home market's own dollar, else US dollars. */
export function dollarCurrencyFor(home: MarketCode): CurrencyCode {
  const c = CURRENCIES[getMarket(home).currency];
  return c.dollar ? c.code : 'USD';
}

/**
 * Which market's settings grade this card. The home market wins unless auto-detect is
 * on and the card is clearly in another currency; then the market for that currency is
 * used (one the user has edited first, else the first market with that currency).
 */
export function resolveMarket(ms: MarketSettings, detected: CurrencyCode | null | undefined): MarketCode {
  const home = getMarket(ms.home);
  if (!ms.autoDetect || !detected || detected === home.currency) return home.code;
  const candidates = MARKETS.filter((m) => m.currency === detected);
  if (candidates.length === 0) return home.code;
  return (candidates.find((m) => ms.profiles[m.code] != null) ?? candidates[0]).code;
}

// ---------------------------------------------------------------------------------------
// Unit conversion
// ---------------------------------------------------------------------------------------

/** Miles → display unit. */
export const toUnit = (mi: number, unit: DistanceUnit) => (unit === 'km' ? mi * KM_PER_MI : mi);
/** Display unit → miles. */
export const fromUnit = (v: number, unit: DistanceUnit) => (unit === 'km' ? v / KM_PER_MI : v);
/** A per-mile rate expressed per display unit. */
export const ratePerUnit = (perMile: number, unit: DistanceUnit) => (unit === 'km' ? perMile / KM_PER_MI : perMile);
/** A per-display-unit rate expressed per mile. */
export const ratePerMile = (perUnit: number, unit: DistanceUnit) => (unit === 'km' ? perUnit * KM_PER_MI : perUnit);

// ---------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------

export interface MoneyFormat {
  currency: CurrencyCode;
  unit: DistanceUnit;
  decimalComma: boolean;
}

export const US_FORMAT: MoneyFormat = { currency: 'USD', unit: 'mi', decimalComma: false };

export function formatFor(code: MarketCode): MoneyFormat {
  const m = getMarket(code);
  return { currency: m.currency, unit: m.unit, decimalComma: m.decimalComma };
}

/** Format used to display a stored record (old records have no currency: US dollars and miles). */
export function recordFormat(r: { currency?: string | null; distanceUnit?: string | null; market?: string | null }): MoneyFormat {
  if (isMarketCode(r.market)) {
    const f = formatFor(r.market);
    return {
      ...f,
      currency: isCurrencyCode(r.currency) ? r.currency : f.currency,
      unit: r.distanceUnit === 'km' || r.distanceUnit === 'mi' ? r.distanceUnit : f.unit,
    };
  }
  return {
    currency: isCurrencyCode(r.currency) ? r.currency : 'USD',
    unit: r.distanceUnit === 'km' ? 'km' : 'mi',
    decimalComma: false,
  };
}

const MINUS = '−';

function num(n: number, decimals: number, comma: boolean): string {
  const s = n.toFixed(decimals);
  return comma ? s.replace('.', ',') : s;
}

function withSymbol(c: CurrencyDef, amount: string): string {
  return c.suffix ? `${amount}${c.symbol}` : `${c.symbol}${amount}`;
}

/** "$18.42", "€18,42", "E£85.50", "KD 1.250", "12,50 zł". */
export function formatMoney(n: number | null | undefined, f: MoneyFormat = US_FORMAT): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const c = CURRENCIES[f.currency];
  const sign = n < 0 ? MINUS : '';
  return sign + withSymbol(c, num(Math.abs(n), c.decimals, f.decimalComma));
}

/** "$36/hr" (whole units), "KD 9.5/hr" for high-value currencies. */
export function formatPerHour(n: number | null | undefined, f: MoneyFormat = US_FORMAT): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const c = CURRENCIES[f.currency];
  const d = c.perUsd < 0.5 ? 1 : 0;
  const a = Math.abs(n);
  const sign = n < 0 ? MINUS : '';
  return `${sign}${withSymbol(c, d === 0 ? String(Math.round(a)) : num(a, d, f.decimalComma))}/hr`;
}

/**
 * Per-distance rate. Input is per MILE (canonical); output is in the format's unit:
 * "68¢/mi" under one unit when the currency has a sub-unit symbol, else "$1.42/mi",
 * "€0,44/km", "E£23.60/km".
 */
export function formatPerDistance(perMile: number | null | undefined, f: MoneyFormat = US_FORMAT): string {
  if (perMile == null || !Number.isFinite(perMile)) return '—';
  const c = CURRENCIES[f.currency];
  const v = ratePerUnit(perMile, f.unit);
  const sign = v < 0 ? MINUS : '';
  const a = Math.abs(v);
  if (c.minor && !f.decimalComma) {
    const minor = Math.round(a * 100);
    if (minor < 100) return `${sign}${minor}${c.minor}/${f.unit}`;
  }
  const d = c.decimals === 0 ? 0 : c.decimals === 3 ? 3 : 2;
  return `${sign}${withSymbol(c, num(a, d, f.decimalComma))}/${f.unit}`;
}

/** Miles (canonical) shown in the format's unit: "13.6 mi", "21.9 km". */
export function formatDistance(mi: number | null | undefined, f: Pick<MoneyFormat, 'unit' | 'decimalComma'> = US_FORMAT): string {
  if (mi == null || !Number.isFinite(mi)) return '—';
  return `${num(toUnit(mi, f.unit), 1, f.decimalComma)} ${f.unit}`;
}

/** Plain number in the market's style, e.g. for "4,93 ★" in comma markets. */
export function formatNumber(n: number | null | undefined, decimals: number, f: Pick<MoneyFormat, 'decimalComma'> = US_FORMAT): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return num(n, decimals, f.decimalComma);
}
