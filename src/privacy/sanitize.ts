/**
 * Rider-name stripping. HARD RULE: no rider name is ever stored or transmitted.
 *
 * Offer cards sometimes show a rider's first name (e.g. "Sarah ★ 4.95", "Picking up
 * Sarah", a lone "Sarah M." line next to the rating). We remove such tokens from every
 * line BEFORE parsing, so names can never leak into areas, raw text, the database,
 * exports or sync. Any name found is then also removed everywhere else on the card.
 *
 * The heuristics are deliberately aggressive near rider context (rating, pickup
 * phrases) and conservative elsewhere, so place names like "Fair Oaks" survive.
 */

export const RIDER_PLACEHOLDER = '[rider]';

/** Words that appear on offer cards and must never be treated as a person's name. */
const CARD_VOCAB = new Set(
  [
    'uber', 'uberx', 'uberxl', 'xl', 'x', 'comfort', 'black', 'suv', 'green', 'share', 'shared', 'pet',
    'connect', 'reserve', 'priority', 'exclusive', 'wav', 'electric', 'lyft', 'standard', 'extra',
    'preferred', 'lux', 'wait', 'save', 'accept', 'match', 'decline', 'trip', 'trips', 'pickup',
    'pick', 'up', 'dropoff', 'drop', 'off', 'away', 'total', 'included', 'incl', 'surge', 'boost',
    'bonus', 'prime', 'time', 'verified', 'new', 'rider', 'riders', 'request', 'requests', 'stop',
    'stops', 'multiple', 'airport', 'est', 'estimated', 'fare', 'tip', 'tips', 'long', 'upfront',
    'tap', 'to', 'min', 'mins', 'mi', 'hr', 'and', 'the', 'of', 'at', 'in', 'near', 'via', 'ride',
    'rides', 'delivery', 'business', 'profile', 'premium', 'pro', 'gold', 'platinum', 'diamond',
    'blue', 'rating', 'rated', 'stars', 'star', 'you', 'your', 'go', 'online', 'offline', 'dismiss',
    'reject', 'close', 'details', 'more', 'see', 'route', 'navigate', 'scheduled', 'reservation',
  ].map((w) => w.toLowerCase())
);

/** Tokens that make a line look like a place/address rather than a name. */
const PLACE_HINT =
  /\b(st|street|rd|road|ave|avenue|blvd|boulevard|dr|drive|pkwy|parkway|way|ln|lane|ct|court|pl|place|hwy|highway|pike|cir|circle|sq|square|plaza|station|mall|airport|center|centre|hospital|university|park|terminal|metro|county|city|heights|hills|village|corner|landing|mill|run|ridge|church|creek|va|md|dc|virginia|maryland|i-\d+|us-\d+|route)\b/i;

/** Arabic-script places and card words that must never be taken for a name. */
const ARABIC_VOCAB = new Set([
  'رحلة', 'الرحلة', 'قبول', 'اقبل', 'رفض', 'بعيد', 'على', 'بعد', 'دقيقة', 'دقائق', 'دقيقه', 'ساعة', 'كم', 'ميل',
  'الإجمالي', 'إجمالي', 'الاجمالي', 'المجموع', 'التقاط', 'الالتقاط', 'استلام', 'توصيل', 'الوجهة', 'راكب', 'الراكب',
  'جديد', 'تقييم', 'أوبر', 'اوبر', 'كريم', 'ليفت', 'مكافأة', 'زيادة', 'إضافي', 'اضافي', 'شامل', 'محطات', 'محطة',
  'توقف', 'توقفات', 'شارع', 'طريق', 'مطار', 'حي', 'مدينة', 'ميدان', 'جامعة', 'مستشفى', 'مول', 'برج', 'مركز', 'سوق',
  'كورنيش', 'جسر', 'كوبري', 'الشيخ', 'زايد', 'التجمع', 'الخامس', 'مصر', 'الجديدة', 'القاهرة', 'الجيزة', 'دبي',
  'الرياض', 'جدة', 'الدوحة', 'عمان', 'الكويت', 'أبوظبي', 'ابوظبي', 'الشارقة', 'مكة', 'المدينة', 'الإسكندرية',
  'ج.م', 'جنيه', 'ريال', 'درهم', 'دينار',
]);
const ARABIC_PLACE_HINT = /(شارع|طريق|مطار|ميدان|محطة|جامعة|مستشفى|مول|برج|مركز|سوق|حي |مدينة|كورنيش|جسر|كوبري)/;

const RATING_RE = /(\d[.,]\d{1,2})\s*[★*✩☆⭐]|[★*✩☆⭐]\s*(\d[.,]\d{1,2})/;
// Latin names, including accented ones (José, Zoë, Ömer, Łukasz).
const UPPER = 'A-Z\u00C0-\u00D6\u00D8-\u00DE\u0100-\u017F';
const LETTER = 'a-zA-Z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F';
const NAME_WORD = `[${UPPER}][${LETTER}'’-]{1,20}`;
const NAME_TOKEN = new RegExp(`^${NAME_WORD}$`);
const ARABIC_WORD = '[\u0621-\u063A\u0641-\u064A\u066E-\u06D3\u06FA-\u06FF]{2,20}';
const ARABIC_TOKEN = new RegExp(`^${ARABIC_WORD}$`);
/** Letters of any script we strip names in; a name must not be glued to one of these. */
const WORD_CHARS = `${LETTER}\u0600-\u06FF`;

/** Case-insensitive literal without the `i` flag (the name part must stay case-sensitive). */
const ci = (phrase: string) => phrase.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`);
const CONTEXT_WORDS = ['picking up', 'pick up', 'pickup for', 'request from', 'requested by', 'rider', 'passenger', 'riding with', 'ride with'];
const CONTEXT_PHRASES = new RegExp(
  `\\b(${CONTEXT_WORDS.map(ci).join('|')})\\s*:?\\s+(${NAME_WORD}(?:\\s+[A-Z]\\.?)?)(?=$|[^${LETTER}])`,
  'g'
);
const POSSESSIVE = new RegExp(`(?:^|[^${LETTER}])(${NAME_WORD})['’]s\\s+(trip|ride|request)\\b`, 'g');
// "الراكب: أحمد" / "راكب أحمد"
const ARABIC_CONTEXT = new RegExp(`(?:الراكب|راكب|العميل)\\s*:?\\s*(${ARABIC_WORD})`, 'g');

export interface SanitizeOptions {
  /** Extra safe words (e.g. zone keywords) that must never be stripped. */
  safeWords?: Iterable<string>;
}

function buildSafe(opts?: SanitizeOptions): Set<string> {
  const safe = new Set(CARD_VOCAB);
  if (opts?.safeWords) {
    for (const w of opts.safeWords) {
      for (const part of String(w).toLowerCase().split(/[\s,]+/)) if (part) safe.add(part);
    }
  }
  return safe;
}

function isSafeWord(w: string, safe: Set<string>): boolean {
  if (ARABIC_VOCAB.has(w) || ARABIC_VOCAB.has(w.replace(/^ال/, ''))) return true;
  const k = w.toLowerCase();
  return safe.has(k) || safe.has(k.replace(/[^a-z]/g, ''));
}

/** 1–3 Arabic-script words, no digits, not a place or card word: a rider's name. */
function looksLikeArabicNameLine(line: string, safe: Set<string>): boolean {
  const t = line.trim().replace(/[.,،]$/, '');
  if (!t || /\d/.test(t) || ARABIC_PLACE_HINT.test(t + ' ')) return false;
  const words = t.split(/\s+/);
  if (words.length < 1 || words.length > 3) return false;
  if (!words.every((w) => ARABIC_TOKEN.test(w))) return false;
  return !words.some((w) => isSafeWord(w, safe));
}

function looksLikeNameLine(line: string, safe: Set<string>): boolean {
  if (/[\u0600-\u06FF]/.test(line)) return looksLikeArabicNameLine(line, safe);
  const t = line.trim().replace(/[.,]$/, '');
  if (!t || /\d/.test(t) || PLACE_HINT.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 1 || words.length > 3) return false;
  // Allow "Sarah", "Sarah M", "Sarah M.", "Mary Ann"
  const core = words.filter((w) => !/^[A-Z]\.?$/.test(w));
  if (core.length === 0 || core.length > 2) return false;
  if (!core.every((w) => NAME_TOKEN.test(w))) return false;
  return !core.some((w) => isSafeWord(w, safe));
}

export interface SanitizeResult {
  lines: string[];
  removedCount: number;
}

/**
 * Sanitizes card lines (in on-screen order). Returns the same number of lines; removed
 * names are replaced by "[rider]" so geometry stays aligned with the OCR boxes.
 */
export function sanitizeLines(input: string[], opts?: SanitizeOptions): SanitizeResult {
  const safe = buildSafe(opts);
  const found = new Set<string>();
  const lines = input.map((l) => l ?? '');

  lines.forEach((line, i) => {
    // 1) Name directly before/after a rating on the same line: "Sarah ★ 4.95", "4.95★ Sarah M."
    if (RATING_RE.test(line)) {
      const m = line.match(RATING_RE);
      const idx = m?.index ?? 0;
      const before = line.slice(0, idx).trim();
      const after = line.slice(idx + (m?.[0].length ?? 0)).trim();
      for (const seg of [before, after]) {
        if (seg && looksLikeNameLine(seg.replace(/[•·|-]+/g, ' '), safe)) {
          seg
            .replace(/[•·|-]+/g, ' ')
            .split(/\s+/)
            .filter((w) => (NAME_TOKEN.test(w) || ARABIC_TOKEN.test(w)) && !isSafeWord(w, safe))
            .forEach((w) => found.add(w));
        }
      }
      // 2) A lone name line adjacent to the rating line.
      for (const j of [i - 1, i + 1]) {
        if (j >= 0 && j < lines.length && looksLikeNameLine(lines[j], safe)) {
          lines[j]
            .split(/\s+/)
            .map((w) => w.replace(/[.,،]$/, ''))
            .filter((w) => (NAME_TOKEN.test(w) || ARABIC_TOKEN.test(w)) && !isSafeWord(w, safe))
            .forEach((w) => found.add(w));
          lines[j] = RIDER_PLACEHOLDER;
        }
      }
    }
    // 3) Context phrases: "Picking up Sarah", "Rider: Sarah M."
    for (const m of line.matchAll(CONTEXT_PHRASES)) {
      const first = m[2].split(/\s+/)[0];
      if (!isSafeWord(first, safe) && !PLACE_HINT.test(m[2])) found.add(first);
    }
    // 4) Possessive: "Sarah's trip"
    for (const m of line.matchAll(POSSESSIVE)) {
      if (!isSafeWord(m[1], safe)) found.add(m[1]);
    }
    for (const m of line.matchAll(ARABIC_CONTEXT)) {
      if (!isSafeWord(m[1], safe)) found.add(m[1]);
    }
  });

  const names = [...found].filter((n) => n.length >= 2);
  const out = lines.map((line) => {
    let l = line;
    for (const n of names) {
      const re = new RegExp(
        `(^|[^${WORD_CHARS}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s+[A-Z]\\.?)?(?=$|[^${WORD_CHARS}])`,
        'g'
      );
      l = l.replace(re, (_all, pre: string) => `${pre}${RIDER_PLACEHOLDER}`);
    }
    return l;
  });
  const removedCount = out.filter((l, i) => l !== input[i]).length;
  return { lines: out, removedCount };
}

export function sanitizeText(text: string, opts?: SanitizeOptions): string {
  return sanitizeLines(text.split(/\r?\n/), opts).lines.join('\n');
}

/** Final defensive pass for any string headed to storage/export/sync. */
export function containsPlaceholderOnly(s: string | null | undefined): boolean {
  return !s || s.replace(/\[rider\]/g, '').trim().length === 0;
}
