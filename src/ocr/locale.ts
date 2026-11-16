import { CURRENCIES, type CurrencyCode } from '../engine/market';

/**
 * Locale-tolerant number and money reading for offer-card text.
 *
 *  - Arabic-Indic (٠١٢٣٤٥٦٧٨٩) and Extended Arabic-Indic / Persian (۰۱۲۳۴۵۶۷۸۹) digits
 *    become ASCII digits; the Arabic decimal (٫) and thousands (٬) separators too.
 *  - Decimal commas ("12,50", "1.234,50") become decimal points, so everything after
 *    normalization can assume "." for decimals and "," for thousands.
 *  - Money is any number next to a known currency token, before or after it
 *    ("$12.50", "€12,50", "12,50 €", "EGP 85", "85 ج.م", "+£3.00").
 */

const ARABIC_INDIC_ZERO = 0x0660;
const EXT_ARABIC_INDIC_ZERO = 0x06f0;

export function normalizeDigits(s: string): string {
  let out = '';
  for (const ch of s ?? '') {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= ARABIC_INDIC_ZERO && c <= ARABIC_INDIC_ZERO + 9) out += String(c - ARABIC_INDIC_ZERO);
    else if (c >= EXT_ARABIC_INDIC_ZERO && c <= EXT_ARABIC_INDIC_ZERO + 9) out += String(c - EXT_ARABIC_INDIC_ZERO);
    else if (ch === '٫') out += '.'; // ARABIC DECIMAL SEPARATOR
    else if (ch === '٬') out += ','; // ARABIC THOUSANDS SEPARATOR
    else if (ch === '،') out += ', '; // ARABIC COMMA
    else out += ch;
  }
  return out;
}

/**
 * Rewrites decimal commas as decimal points.
 *   "1.234,50" → "1234.50"   (European thousands dot + decimal comma)
 *   "12,50"    → "12.50"     (one or two digits after the comma = decimals)
 *   "1,234"    stays          (three digits after the comma = thousands separator)
 */
export function normalizeDecimalCommas(s: string): string {
  return s
    .replace(/(\d{1,3})\.(\d{3}),(\d{1,2})(?!\d)/g, '$1$2.$3')
    .replace(/(\d)\s*,(\d{1,2})(?![\d])/g, '$1.$2');
}

/** Parses one number in either convention. Returns null when it isn't a number. */
export function parseLocaleNumber(raw: string): number | null {
  if (raw == null) return null;
  let s = normalizeDigits(String(raw)).replace(/[\s  ']/g, '').replace(/^\+/, '');
  if (!/^-?[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Whichever separator comes last is the decimal one.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const parts = s.split(',');
    const decimalComma = parts.length === 2 && parts[1].length >= 1 && parts[1].length <= 2;
    s = decimalComma ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if ((s.match(/\./g) ?? []).length > 1) {
    // "1.234.567" — dots as thousands separators.
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------------------
// Currency tokens
// ---------------------------------------------------------------------------------------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface TokenEntry {
  token: string;
  currency: CurrencyCode | '$';
}

const TOKENS: TokenEntry[] = [
  ...Object.values(CURRENCIES).flatMap((c) => c.tokens.map((token) => ({ token, currency: c.code as CurrencyCode }))),
  { token: '$', currency: '$' as const },
].sort((a, b) => b.token.length - a.token.length);

const ISO_CODES = new Set(Object.keys(CURRENCIES));
const TOKEN_LOOKUP =new Map(TOKENS.map((t) => [t.token.toLowerCase(), t.currency]));
const TOKEN_ALT = TOKENS.map((t) => escapeRe(t.token)).join('|');
const AMOUNT = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d{1,3})?|\d{1,6}(?:\.\d{1,3})?`;

// Prefix form: [+] TOKEN amount      Suffix form: [+] amount TOKEN
// The leading group stands in for a lookbehind (not every JS engine has one): the token
// or number must not be glued to a preceding letter or digit ("US$" is its own token).
const MONEY_RE = new RegExp(
  String.raw`(^|[^A-Za-z0-9.,])(\+\s?)?(?:(${TOKEN_ALT})\s?(${AMOUNT})(?![\d])|(${AMOUNT})\s?(${TOKEN_ALT})(?![A-Za-z]))`,
  'gi'
);

export interface MoneyMatch {
  value: number;
  plus: boolean;
  currency: CurrencyCode;
  /** True when the currency came from a bare "$" (resolved with dollarCurrency). */
  bareDollar: boolean;
  index: number;
}

function tokenCurrency(token: string): CurrencyCode | '$' | null {
  return TOKEN_LOOKUP.get(token.toLowerCase()) ?? null;
}

/** Every money amount on a (normalized) line. A bare "$" means `dollarCurrency`. */
export function scanMoney(line: string, dollarCurrency: CurrencyCode = 'USD'): MoneyMatch[] {
  const out: MoneyMatch[] = [];
  for (const m of line.matchAll(MONEY_RE)) {
    const token = m[3] ?? m[6];
    const amount = m[4] ?? m[5];
    if (!token || !amount) continue;
    // Case-insensitive matching is for codes like "Egp"/"Rs"; reject lowercase look-alikes
    // of short Latin codes inside ordinary text ("le", "tl", "sr").
    if (/^[A-Za-z.]{2,4}$/.test(token) && token === token.toLowerCase() && token !== 'zł') continue;
    const cur = tokenCurrency(token);
    if (!cur) continue;
    // Short informal tokens (SR, LE, KD, Rs, TL…) also appear in road names ("SR 7") and
    // words, so they only count as money with decimals: "SR 23.50", "LE 85.00".
    if (/^[A-Za-z.]+$/.test(token) && !ISO_CODES.has(token.toUpperCase()) && !/\.\d/.test(amount)) continue;
    const value = parseFloat(amount.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    out.push({
      value,
      plus: !!m[2],
      currency: cur === '$' ? dollarCurrency : cur,
      bareDollar: cur === '$',
      index: (m.index ?? 0) + (m[1]?.length ?? 0),
    });
  }
  return out;
}

/**
 * The card's currency: explicit codes/symbols (€, £, EGP…) outvote a bare "$", which
 * means `dollarCurrency`. Null when the card shows no money at all.
 */
export function detectCurrency(lines: string[], dollarCurrency: CurrencyCode = 'USD'): CurrencyCode | null {
  const votes = new Map<CurrencyCode, number>();
  let sawDollar = false;
  for (const l of lines) {
    for (const m of scanMoney(l, dollarCurrency)) {
      if (m.bareDollar) {
        sawDollar = true;
        continue;
      }
      votes.set(m.currency, (votes.get(m.currency) ?? 0) + 1);
    }
  }
  let best: CurrencyCode | null = null;
  let bestN = 0;
  for (const [c, n] of votes) {
    if (n > bestN) {
      best = c;
      bestN = n;
    }
  }
  return best ?? (sawDollar ? dollarCurrency : null);
}
