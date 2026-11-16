import { CURRENCIES, KM_PER_MI, type CurrencyCode, type DistanceUnit } from '../engine/market';
import type { CardInput, OfferField, ParsedOffer, Platform } from '../engine/types';
import { RIDER_PLACEHOLDER, sanitizeLines } from '../privacy/sanitize';
import { detectCurrency, normalizeDecimalCommas, normalizeDigits, scanMoney } from './locale';

/**
 * Offer-card parser with two extraction paths:
 *
 *  1. PRIMARY — fixed card regions. The native layer hands us OCR lines with boxes
 *     normalized to the card. Each platform template splits the card into a header band
 *     (fare, bonus, product, rating), a pickup band and a trip band, and each field is
 *     read only from its band.
 *  2. FALLBACK — whole-card pattern scan. Any field that the region read left empty or
 *     implausible is re-read by pattern-matching the full card text (keywords such as
 *     "away"/"trip", ordering, "total" arithmetic).
 *
 * Every field records which path produced it, and the offer's readPath is "fallback"
 * if any field needed the fallback.
 *
 * International cards: Arabic-Indic digits and decimal commas are normalized first,
 * money is read in any known currency (the card's currency is detected), distances in
 * km are converted to miles, and common Arabic unit/keyword spellings are understood.
 */

interface Line {
  idx: number;
  text: string;
  x: number;
  y: number;
  h: number;
  cy: number;
}

export interface Region {
  from: number;
  to: number;
}

export interface CardTemplate {
  header: Region;
  pickup: Region;
  trip: Region;
}

export const TEMPLATES: Record<Platform, CardTemplate> = {
  // Uber: product + fare + rating on top, "N min (N mi) away" + pickup address,
  // then "N min (N mi) trip" + dropoff address, then Accept.
  uber: { header: { from: 0, to: 0.36 }, pickup: { from: 0.24, to: 0.62 }, trip: { from: 0.5, to: 0.96 } },
  // Lyft: similar stacking, fare band is slightly taller (bonus chips).
  lyft: { header: { from: 0, to: 0.4 }, pickup: { from: 0.26, to: 0.66 }, trip: { from: 0.52, to: 0.97 } },
  unknown: { header: { from: 0, to: 0.38 }, pickup: { from: 0.24, to: 0.64 }, trip: { from: 0.5, to: 0.97 } },
};

// ---------------------------------------------------------------------------------------
// Normalization & tokens
// ---------------------------------------------------------------------------------------

export function normalizeLine(s: string): string {
  return normalizeDecimalCommas(
    normalizeDigits(s ?? '')
      .replace(/[’‘`]/g, "'")
      .replace(/[•·∙]/g, ' · ')
      .replace(/(^|[^A-Za-z])S(\d{1,3}[.,]\d{2})(?!\d)/g, '$1$$$2') // OCR: "S12.50" -> "$12.50"
      .replace(/([$€£₹₺₦¥])\s+(\d)/g, '$1$2')
  )
    .replace(/\brnin(s?)\b/gi, 'min$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const SURGE_WORDS =
  /\b(surge|boost|bonus|prime\s*time|incl(?:uded|\.)?|quest|streak|promo|extra|zuschlag|majoration|recargo|tarifa\s+dinámica)\b|مكافأة|مكافاة|زيادة|إضافي|اضافي|شامل/i;
const NOT_FARE_WORDS = /(\/\s*hr|per\s*hour|\/\s*mi|per\s*mile|\/\s*km|per\s*km|tip|est\.?\s*rate)/i;
// Units end at a non-letter instead of \b: \b does not work next to Arabic letters.
const END = '(?![A-Za-z])';
const HOUR_UNIT = `(?:hours|hour|hrs|hr|h|std|ساعة|ساعات|ساعه)${END}`;
const MIN_UNIT_LONG = `(?:minutes|mins|min|mn|دقيقة|دقائق|دقيقه|دقيقتين)${END}`;
const MIN_UNIT_SHORT = `(?:minutes|mins|min|mn|m|دقيقة|دقائق|دقيقه)${END}`;
const TIME_RE = new RegExp(
  `(?:(\\d{1,2})\\s*${HOUR_UNIT}\\.?\\s*(?:(\\d{1,2})\\s*${MIN_UNIT_SHORT})?|(\\d{1,3})\\s*${MIN_UNIT_LONG})`,
  'gi'
);
/** Group 2 = unit. Kilometres, miles, and metres written out ("800 m" only inside brackets). */
const DIST_RE = new RegExp(
  `(\\d{1,4}(?:\\.\\d{1,3})?)\\s*(miles|mile|mi|kilometers|kilometres|kms|km|ميل|أميال|اميال|كيلومتر|كيلو|كم|meters|metres|متر|m(?=\\s*\\)))${END}`,
  'gi'
);
const TOTAL_WORDS = /\btotal\b|\bgesamt\b|\btotale\b|الإجمالي|إجمالي|الاجمالي|اجمالي|المجموع/i;
const RATING_RE = /(\d\.\d{1,2})\s*[★*✩☆⭐]|[★*✩☆⭐]\s*(\d\.\d{1,2})/;
const RATING_LOOSE = /(?:^|\s)([3-5]\.\d{2})(?:\s|$)/;
const BUTTON_RE = /^(accept|match|decline|tap to accept|reject|dismiss|confirm|x|قبول|اقبل|رفض|تأكيد)$/i;
const MULTISTOP_RE =
  /\b(\d)\s*stops?\b|multiple stops|multi-?\s*stop|\+\s*\d?\s*stops?\b|includes?\s+(?:a|an|\d)?\s*(?:extra\s+)?stops?\b|additional stops?|with stops?\b/i;

const OFFER_TYPES: Array<{ re: RegExp; label: string; platform: Platform }> = [
  { re: /\buber\s?x\s?share\b/i, label: 'UberX Share', platform: 'uber' },
  { re: /\bcomfort\s+electric\b/i, label: 'Comfort Electric', platform: 'uber' },
  { re: /\buber\s?xl\b/i, label: 'UberXL', platform: 'uber' },
  { re: /\bblack\s+suv\b/i, label: 'Uber Black SUV', platform: 'uber' },
  { re: /\buber\s+black\b/i, label: 'Uber Black', platform: 'uber' },
  { re: /\buber\s+green\b/i, label: 'Uber Green', platform: 'uber' },
  { re: /\buber\s+pet\b/i, label: 'Uber Pet', platform: 'uber' },
  { re: /\buber\s?x\s+priority\b/i, label: 'UberX Priority', platform: 'uber' },
  { re: /\buber\s+connect\b/i, label: 'Uber Connect', platform: 'uber' },
  { re: /\buber\s+reserve\b|\breserve\b/i, label: 'Reserve', platform: 'uber' },
  { re: /\bexclusive\b/i, label: 'Exclusive', platform: 'uber' },
  { re: /\b(?:uber\s+)?comfort\b/i, label: 'Comfort', platform: 'uber' },
  { re: /\buber\s?x\b/i, label: 'UberX', platform: 'uber' },
  { re: /\blux\s+black\s+xl\b/i, label: 'Lux Black XL', platform: 'lyft' },
  { re: /\blux\s+black\b/i, label: 'Lux Black', platform: 'lyft' },
  { re: /\blyft\s+lux\b|\blux\b/i, label: 'Lux', platform: 'lyft' },
  { re: /\blyft\s+xl\b/i, label: 'Lyft XL', platform: 'lyft' },
  { re: /\bextra\s+comfort\b/i, label: 'Extra Comfort', platform: 'lyft' },
  { re: /\bpreferred\b/i, label: 'Preferred', platform: 'lyft' },
  { re: /\bpriority\s+pickup\b/i, label: 'Priority Pickup', platform: 'lyft' },
  { re: /\bwait\s*&?\s*save\b/i, label: 'Wait & Save', platform: 'lyft' },
  { re: /\blyft\s+pet\b/i, label: 'Lyft Pet', platform: 'lyft' },
  { re: /\bshared?\s+(?:ride|saver)\b|\blyft\s+shared?\b/i, label: 'Shared', platform: 'lyft' },
  { re: /\bstandard\b/i, label: 'Standard', platform: 'lyft' },
  { re: /\bxl\b/i, label: 'XL', platform: 'unknown' },
  { re: /\bpriority\b/i, label: 'Priority', platform: 'unknown' },
  { re: /\bblack\b/i, label: 'Black', platform: 'unknown' },
  { re: /\bshare\b/i, label: 'Share', platform: 'unknown' },
];

interface Metric {
  min: number | null;
  mi: number | null;
}

interface TimeToken {
  index: number;
  minutes: number;
}
interface DistToken {
  index: number;
  miles: number;
  unit: DistanceUnit;
}

function timeTokens(s: string): TimeToken[] {
  const out: TimeToken[] = [];
  for (const m of s.matchAll(TIME_RE)) {
    let minutes: number;
    if (m[1] != null) minutes = parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
    else minutes = parseInt(m[3], 10);
    if (Number.isFinite(minutes)) out.push({ index: m.index ?? 0, minutes });
  }
  return out;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Distances on a line, converted to MILES (the app's canonical unit). */
function distTokens(s: string): DistToken[] {
  const out: DistToken[] = [];
  for (const m of s.matchAll(DIST_RE)) {
    const v = parseFloat(m[1]);
    if (!Number.isFinite(v)) continue;
    const u = m[2].toLowerCase();
    if (/^(mi|mile|miles|ميل|أميال|اميال)$/.test(u)) out.push({ index: m.index ?? 0, miles: v, unit: 'mi' });
    else if (/^(m|meters|metres|متر)$/.test(u)) out.push({ index: m.index ?? 0, miles: r3(v / 1000 / KM_PER_MI), unit: 'km' });
    else out.push({ index: m.index ?? 0, miles: r3(v / KM_PER_MI), unit: 'km' });
  }
  return out;
}

/** The distance unit the card is written in, or null if it shows no distance. */
function detectUnit(text: string): DistanceUnit | null {
  const units = distTokens(text).map((d) => d.unit);
  if (units.includes('km')) return 'km';
  return units.length ? 'mi' : null;
}

/** Time/distance pairs on one line, in reading order. "4 min (1.2 mi)" or "1.2 mi · 4 min". */
export function metricPairs(s: string): Metric[] {
  const times = timeTokens(s);
  const dists = distTokens(s);
  const used = new Set<number>();
  const pairs: Array<Metric & { index: number }> = [];
  for (const d of dists) {
    let best = -1;
    let bestGap = Infinity;
    times.forEach((t, i) => {
      if (used.has(i)) return;
      const gap = Math.abs(t.index - d.index);
      if (gap < bestGap && gap <= 28) {
        bestGap = gap;
        best = i;
      }
    });
    if (best >= 0) {
      used.add(best);
      pairs.push({ min: times[best].minutes, mi: d.miles, index: Math.min(times[best].index, d.index) });
    }
  }
  return pairs.sort((a, b) => a.index - b.index).map(({ min, mi }) => ({ min, mi }));
}

function lineMetric(s: string): Metric | null {
  const p = metricPairs(s);
  if (p.length > 0) return p[0];
  const t = timeTokens(s);
  const d = distTokens(s);
  if (t.length === 1 && d.length === 0) return { min: t[0].minutes, mi: null };
  if (d.length === 1 && t.length === 0) return { min: null, mi: d[0].miles };
  return null;
}

/** Currency a bare "$" means while parsing the current card (set per parseCard call). */
let dollarCurrency: CurrencyCode = 'USD';

function moneyAmounts(s: string): Array<{ value: number; plus: boolean }> {
  return scanMoney(s, dollarCurrency).map((m) => ({ value: m.value, plus: m.plus }));
}

// ---------------------------------------------------------------------------------------
// Plausibility
// ---------------------------------------------------------------------------------------

const inRange = (v: number | null, lo: number, hi: number) => v != null && Number.isFinite(v) && v >= lo && v <= hi;

/** Fare/bonus ranges are in US dollars and scale with the card's currency. */
const fxOf = (c: CurrencyCode | null | undefined) => (c ? CURRENCIES[c].perUsd : 1);

export const plausible = {
  fare: (v: number | null, c?: CurrencyCode | null) =>
    !c || c === 'USD' ? inRange(v, 2.5, 800) : inRange(v, 0.5 * fxOf(c), 800 * Math.max(1, fxOf(c))),
  surge: (v: number | null, c?: CurrencyCode | null) => inRange(v, 0.25 * Math.min(1, fxOf(c)), 300 * Math.max(1, fxOf(c))),
  pickupMi: (v: number | null) => inRange(v, 0, 30),
  pickupMin: (v: number | null) => inRange(v, 0, 75),
  tripMi: (v: number | null) => inRange(v, 0.1, 300),
  tripMin: (v: number | null) => inRange(v, 1, 420),
  rating: (v: number | null) => inRange(v, 1, 5),
  speed: (mi: number | null, min: number | null, lo: number, hi: number) => {
    if (mi == null || min == null || min <= 0) return true;
    const mph = mi / (min / 60);
    return mph >= lo && mph <= hi;
  },
};

// ---------------------------------------------------------------------------------------
// Field readers
// ---------------------------------------------------------------------------------------

function detectPlatform(text: string): Platform {
  if (/\blyft\b/i.test(text)) return 'lyft';
  if (/\buber|uberx|\buber\s?xl\b/i.test(text)) return 'uber';
  for (const t of OFFER_TYPES) if (t.platform !== 'unknown' && t.re.test(text)) return t.platform;
  return 'unknown';
}

function readOfferType(text: string): string | null {
  for (const t of OFFER_TYPES) if (t.re.test(text)) return t.label;
  return null;
}

function readFare(lines: Line[]): number | null {
  let best: { value: number; h: number; idx: number } | null = null;
  for (const l of lines) {
    if (SURGE_WORDS.test(l.text) || NOT_FARE_WORDS.test(l.text)) continue;
    for (const a of moneyAmounts(l.text)) {
      if (a.plus) continue;
      if (!best || l.h > best.h + 0.005 || (Math.abs(l.h - best.h) <= 0.005 && l.idx < best.idx)) {
        best = { value: a.value, h: l.h, idx: l.idx };
      }
    }
  }
  return best ? best.value : null;
}

function readSurge(lines: Line[]): { value: number | null; included: boolean } {
  for (const l of lines) {
    const amounts = moneyAmounts(l.text);
    const plus = amounts.find((a) => a.plus);
    if (plus) return { value: plus.value, included: /incl/i.test(l.text) };
    if (SURGE_WORDS.test(l.text) && amounts.length > 0) {
      return { value: amounts[0].value, included: /incl/i.test(l.text) };
    }
  }
  return { value: null, included: false };
}

function readRating(lines: Line[]): number | null {
  for (const l of lines) {
    const m = l.text.match(RATING_RE);
    if (m) {
      const v = parseFloat(m[1] ?? m[2]);
      if (plausible.rating(v)) return v;
    }
  }
  for (const l of lines) {
    if (moneyAmounts(l.text).length > 0 || /\$/.test(l.text) || /\b(mi|min|km|x)\b/i.test(l.text)) continue;
    const m = l.text.match(RATING_LOOSE);
    if (m) {
      const v = parseFloat(m[1]);
      if (plausible.rating(v)) return v;
    }
  }
  return null;
}

function isAreaLike(text: string): boolean {
  const t = text.trim();
  if (t.length < 3 || t === RIDER_PLACEHOLDER) return false;
  if (BUTTON_RE.test(t)) return false;
  if (moneyAmounts(t).length > 0) return false;
  if (lineMetric(t)) return false;
  if (RATING_RE.test(t) || /^[\d.\s★*]+$/.test(t)) return false;
  if (MULTISTOP_RE.test(t) && t.split(/\s+/).length <= 3) return false;
  if (/^(trip|pickup|pick up|dropoff|drop off|away|verified|new rider|long trip|exclusive|upfront fare)$/i.test(t)) return false;
  if (TOTAL_WORDS.test(t) && t.split(/\s+/).length <= 2) return false;
  if (readOfferType(t) && t.split(/\s+/).length <= 3) return false;
  return /[A-Za-z\u00C0-\u024F\u0621-\u064A]{3,}/.test(t);
}

/** Area text displayed after a metric line, up to the next metric/button. */
function readAreaAfter(all: Line[], afterIdx: number, maxDy = 0.3): string | null {
  const anchor = all.find((l) => l.idx === afterIdx);
  if (!anchor) return null;
  const parts: string[] = [];
  for (const l of all) {
    if (l.idx <= afterIdx) continue;
    if (l.cy - anchor.cy > maxDy) break;
    if (lineMetric(l.text) || BUTTON_RE.test(l.text.trim())) break;
    if (isAreaLike(l.text)) {
      parts.push(l.text.replace(/\s*\[rider\]\s*/g, ' ').trim());
      if (parts.length === 2) break;
    } else if (parts.length > 0) {
      break;
    }
  }
  if (parts.length === 0) return null;
  // Second line only if it looks like a continuation (city/state or short locality).
  if (parts.length === 2 && !(parts[1].length <= 40 && /^[A-Z]/.test(parts[1]))) parts.pop();
  return parts.join(', ').replace(/\s+,/g, ',').slice(0, 160);
}

function inRegion(l: Line, r: Region) {
  return l.cy >= r.from && l.cy < r.to;
}

interface Extract {
  fare: number | null;
  surge: number | null;
  surgeIncluded: boolean;
  pickupMi: number | null;
  pickupMin: number | null;
  tripMi: number | null;
  tripMin: number | null;
  pickupArea: string | null;
  dropoffArea: string | null;
  riderRating: number | null;
  offerType: string | null;
  totalMi: number | null;
  totalMin: number | null;
}

const isTotalLine = (l: Line) => TOTAL_WORDS.test(l.text);

function readTotal(lines: Line[]): Metric | null {
  for (const l of lines) {
    if (!isTotalLine(l)) continue;
    const m = lineMetric(l.text);
    if (m) return m;
  }
  return null;
}

function primaryRead(lines: Line[], tpl: CardTemplate): Extract {
  const header = lines.filter((l) => inRegion(l, tpl.header));
  const surge = readSurge(header);
  // A line that names the other leg ("… trip" in the pickup band) is never taken for this one.
  const saysTrip = (l: Line) => TRIP_WORDS.test(l.text) && !PICKUP_WORDS.test(l.text);
  const saysPickup = (l: Line) => PICKUP_WORDS.test(l.text) && !TRIP_WORDS.test(l.text);
  const pickupLine = lines.find(
    (l) => inRegion(l, tpl.pickup) && !isTotalLine(l) && !saysTrip(l) && metricPairs(l.text).length > 0
  );
  const tripLine = lines.find(
    (l) =>
      inRegion(l, tpl.trip) &&
      !isTotalLine(l) &&
      !saysPickup(l) &&
      metricPairs(l.text).length > 0 &&
      (!pickupLine || l.idx > pickupLine.idx)
  );
  const totalM = readTotal(lines);
  const pm = pickupLine ? metricPairs(pickupLine.text)[0] : null;
  const tm = tripLine ? metricPairs(tripLine.text)[0] : null;
  return {
    fare: readFare(header),
    surge: surge.value,
    surgeIncluded: surge.included,
    pickupMi: pm?.mi ?? null,
    pickupMin: pm?.min ?? null,
    tripMi: tm?.mi ?? null,
    tripMin: tm?.min ?? null,
    pickupArea: pickupLine ? readAreaAfter(lines, pickupLine.idx) : null,
    dropoffArea: tripLine ? readAreaAfter(lines, tripLine.idx) : null,
    riderRating: readRating(header),
    offerType: readOfferType(header.map((l) => l.text).join(' ')),
    totalMi: totalM?.mi ?? null,
    totalMin: totalM?.min ?? null,
  };
}

const PICKUP_WORDS = /\b(away|pickup|pick up|to pickup|to rider|abholung|recogida|prise en charge)\b|بعيد|على بعد|الالتقاط|التقاط|استلام/i;
const TRIP_WORDS = /\b(trip|ride|drop ?off|destination|fahrt|viaje|trajet|course)\b|رحلة|الرحلة|الوجهة|توصيل/i;

function fallbackRead(lines: Line[]): Extract {
  const surge = readSurge(lines);
  type Found = { line: Line; m: Metric; kind: 'pickup' | 'trip' | 'total' | 'unknown' };
  const found: Found[] = [];
  for (const l of lines) {
    for (const m of metricPairs(l.text)) {
      const kind = PICKUP_WORDS.test(l.text)
        ? 'pickup'
        : TOTAL_WORDS.test(l.text)
          ? 'total'
          : TRIP_WORDS.test(l.text)
            ? 'trip'
            : 'unknown';
      found.push({ line: l, m, kind });
    }
  }
  let pickup = found.find((f) => f.kind === 'pickup') ?? null;
  let trip = found.find((f) => f.kind === 'trip') ?? null;
  const total = found.find((f) => f.kind === 'total') ?? null;
  const unknown = found.filter((f) => f.kind === 'unknown');
  if (!pickup && !trip && unknown.length >= 2) {
    pickup = unknown[0];
    trip = unknown[1];
  } else if (!pickup && unknown.length >= 1 && trip && unknown[0].line.idx < trip.line.idx) {
    pickup = unknown[0];
  } else if (!trip && unknown.length >= 1) {
    trip = unknown.find((u) => !pickup || u.line.idx > pickup.line.idx) ?? null;
  }

  let tripMi = trip?.m.mi ?? null;
  let tripMin = trip?.m.min ?? null;
  if (!trip && total && pickup) {
    // "Total 26 min (12.4 mi)" + pickup leg => trip = total - pickup
    tripMi = total.m.mi != null && pickup.m.mi != null ? Math.max(0, +(total.m.mi - pickup.m.mi).toFixed(1)) : null;
    tripMin = total.m.min != null && pickup.m.min != null ? Math.max(0, total.m.min - pickup.m.min) : null;
  }

  return {
    fare: readFare(lines),
    surge: surge.value,
    surgeIncluded: surge.included,
    pickupMi: pickup?.m.mi ?? null,
    pickupMin: pickup?.m.min ?? null,
    tripMi,
    tripMin,
    pickupArea: pickup ? readAreaAfter(lines, pickup.line.idx, 0.4) : null,
    dropoffArea: trip ? readAreaAfter(lines, trip.line.idx, 0.4) : total ? readAreaAfter(lines, total.line.idx, 0.4) : null,
    riderRating: readRating(lines),
    offerType: readOfferType(lines.map((l) => l.text).join(' ')),
    totalMi: total?.m.mi ?? null,
    totalMin: total?.m.min ?? null,
  };
}

// ---------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------

export interface ParseOptions {
  /** Words that must never be stripped as names (zone keywords). */
  safeWords?: Iterable<string>;
  /** What a bare "$" means on this driver's cards (home market's dollar). Default USD. */
  dollarCurrency?: CurrencyCode;
}

export function parseCard(input: CardInput, opts?: ParseOptions): ParsedOffer {
  // Lines: prefer boxed lines from native; fall back to plain text with synthetic geometry.
  let raw = input.lines.length > 0 ? input.lines : textToLines(input.text);
  raw = [...raw].sort((a, b) => a.y - b.y || a.x - b.x);

  // Privacy first: strip rider names before anything is parsed or kept.
  const sanitized = sanitizeLines(
    raw.map((l) => normalizeLine(l.text)),
    { safeWords: opts?.safeWords }
  ).lines;

  const lines: Line[] = raw.map((l, idx) => ({
    idx,
    text: sanitized[idx],
    x: l.x,
    y: l.y,
    h: l.h,
    cy: l.y + l.h / 2,
  }));
  const fullText = lines.map((l) => l.text).join('\n');
  dollarCurrency = opts?.dollarCurrency ?? 'USD';
  const currency = detectCurrency(
    lines.map((l) => l.text),
    dollarCurrency
  );
  const distanceUnit = detectUnit(fullText);
  const platform = detectPlatform(fullText);
  const tpl = TEMPLATES[platform];

  const p = primaryRead(lines, tpl);
  const fb = fallbackRead(lines);
  const fallbackFields: OfferField[] = [];

  const pick = <K extends keyof Extract>(
    field: OfferField,
    key: K,
    ok: (v: Extract[K]) => boolean
  ): Extract[K] => {
    if (ok(p[key])) return p[key];
    if (ok(fb[key])) {
      fallbackFields.push(field);
      return fb[key];
    }
    return null as Extract[K];
  };

  // Pair-level checks: a pickup/trip read must also have a believable speed.
  const pickupSpeedOk = plausible.speed(p.pickupMi, p.pickupMin, 1, 75);
  if (!pickupSpeedOk) {
    p.pickupMi = null;
    p.pickupMin = null;
  }
  const tripSpeedOk = plausible.speed(p.tripMi, p.tripMin, 3, 85);
  if (!tripSpeedOk) {
    p.tripMi = null;
    p.tripMin = null;
  }
  if (!plausible.speed(fb.tripMi, fb.tripMin, 3, 85)) {
    fb.tripMi = null;
    fb.tripMin = null;
  }

  const fare = pick('fare', 'fare', (v) => plausible.fare(v as number | null, currency));
  const surge = pick('surge', 'surge', (v) => plausible.surge(v as number | null, currency));
  const surgeIncluded = surge == null ? false : fallbackFields.includes('surge') ? fb.surgeIncluded : p.surgeIncluded;
  let pickupMi = pick('pickupMi', 'pickupMi', (v) => plausible.pickupMi(v as number | null));
  let pickupMin = pick('pickupMin', 'pickupMin', (v) => plausible.pickupMin(v as number | null));
  let tripMi = pick('tripMi', 'tripMi', (v) => plausible.tripMi(v as number | null));
  let tripMin = pick('tripMin', 'tripMin', (v) => plausible.tripMin(v as number | null));
  const totalMi = pick('totalMi', 'totalMi', (v) => plausible.tripMi(v as number | null));
  const totalMin = pick('totalMin', 'totalMin', (v) => plausible.tripMin(v as number | null));

  // A card "Total" line fills in a leg that could not be read: leg = total − other leg.
  const fill = (field: OfferField, total: number | null, other: number | null, ok: (v: number) => boolean, dp: number) => {
    if (total == null || other == null || total <= other) return null;
    const v = Math.round((total - other) * 10 ** dp) / 10 ** dp;
    if (!ok(v)) return null;
    if (!fallbackFields.includes(field)) fallbackFields.push(field);
    return v;
  };
  if (tripMi == null) tripMi = fill('tripMi', totalMi, pickupMi, (v) => plausible.tripMi(v), 3);
  if (tripMin == null) tripMin = fill('tripMin', totalMin, pickupMin, (v) => plausible.tripMin(v), 0);
  if (pickupMi == null) pickupMi = fill('pickupMi', totalMi, tripMi, (v) => plausible.pickupMi(v), 3);
  if (pickupMin == null) pickupMin = fill('pickupMin', totalMin, tripMin, (v) => plausible.pickupMin(v), 0);
  const pickupArea = pick('pickupArea', 'pickupArea', (v) => typeof v === 'string' && v.length >= 3);
  const dropoffArea = pick('dropoffArea', 'dropoffArea', (v) => typeof v === 'string' && v.length >= 3);
  const riderRating = pick('riderRating', 'riderRating', (v) => plausible.rating(v as number | null));
  const offerType = pick('offerType', 'offerType', (v) => typeof v === 'string' && v.length > 0);

  const ms = fullText.match(MULTISTOP_RE);
  const multiStop = !!ms;
  const countMatch = fullText.match(/\b(\d)\s*(?:extra\s+|additional\s+)?stops?\b/i);
  const stopCount = multiStop ? (countMatch ? parseInt(countMatch[1], 10) : 1) : null;

  // Confidence: weighted coverage of the fields grading depends on, discounted for
  // fallback reads and for the lower-quality full-frame pass.
  const weights: Array<[unknown, number]> = [
    [fare, 0.3],
    [tripMi, 0.15],
    [tripMin, 0.15],
    [pickupMi, 0.1],
    [pickupMin, 0.1],
    [dropoffArea, 0.1],
    [platform !== 'unknown' ? platform : null, 0.05],
    [offerType, 0.05],
  ];
  let confidence = weights.reduce((acc, [v, w]) => acc + (v != null ? w : 0), 0);
  const coreFallbacks = fallbackFields.filter(
    (f) => f !== 'riderRating' && f !== 'offerType' && f !== 'surge' && f !== 'totalMi' && f !== 'totalMin'
  ).length;
  confidence *= Math.max(0.5, 1 - 0.08 * coreFallbacks);
  if (input.pass === 'frame') confidence *= 0.9;
  confidence = Math.round(Math.min(1, Math.max(0, confidence)) * 100) / 100;

  return {
    platform,
    fare,
    surge,
    surgeIncluded,
    pickupMi,
    pickupMin,
    tripMi,
    tripMin,
    totalMi,
    totalMin,
    pickupArea,
    dropoffArea,
    riderRating,
    offerType,
    currency,
    distanceUnit,
    multiStop,
    stopCount,
    readPath: fallbackFields.length > 0 ? 'fallback' : 'primary',
    fallbackFields,
    confidence,
    rawText: fullText,
  };
}

/** Builds evenly spaced pseudo-boxes from plain text (used for tests / simulated offers). */
export function textToLines(text: string): CardInput['lines'] {
  const rows = text.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
  const n = Math.max(rows.length, 1);
  return rows.map((t, i) => ({ text: t, x: 0.05, y: i / n, w: 0.9, h: 0.8 / n }));
}
