import type { Zone, ZoneClass, ZoneMatch } from './types';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, case-insensitive match. Punctuation/spacing inside a keyword is flexible. */
export function keywordMatches(text: string, keyword: string): boolean {
  const k = keyword.trim();
  if (!k) return false;
  const parts = k.split(/[\s,]+/).filter(Boolean).map(escapeRegExp);
  if (parts.length === 0) return false;
  const pattern = `(^|[^A-Za-z0-9])${parts.join('[\\s,.-]*')}(?=$|[^A-Za-z0-9])`;
  return new RegExp(pattern, 'i').test(text);
}

const CLASS_PRIORITY: Record<ZoneClass, number> = { dead: 3, hot: 2, neutral: 1 };

/**
 * Classifies a dropoff text. The longest matching keyword wins (so "Washington Dulles"
 * beats "Washington"); ties go to dead > hot > neutral so a penalty is never missed.
 * Unmatched text is neutral.
 */
export function matchZone(text: string | null | undefined, zones: Zone[]): ZoneMatch {
  if (!text) return { zoneClass: 'neutral', keyword: null };
  let best: Zone | null = null;
  for (const z of zones) {
    if (!keywordMatches(text, z.keyword)) continue;
    if (
      !best ||
      z.keyword.length > best.keyword.length ||
      (z.keyword.length === best.keyword.length && CLASS_PRIORITY[z.zoneClass] > CLASS_PRIORITY[best.zoneClass])
    ) {
      best = z;
    }
  }
  return best ? { zoneClass: best.zoneClass, keyword: best.keyword } : { zoneClass: 'neutral', keyword: null };
}
