import type { OverlaySettings } from '../config/defaults';
import { formatPerHour, formatPerMile, money, VERDICT_COLORS } from './grading';
import type { GradeResult, ParsedOffer } from './types';

/**
 * Overlay layout (top to bottom), built for a one-second glance:
 *
 *   NET / HOUR        NET / MILE        ← small labels
 *   $36/hr            68¢/mi            ← the two huge headline numbers
 *   [ GREAT ]  Clears $30/hr and $1.25/mi net   ← verdict + reason support them
 *   Long pickup (14 min) · Multi-stop           ← optional flags
 *
 * The card's background colour is the verdict colour, so the tier still reads instantly
 * even though the numbers lead.
 */
export interface OverlayContent {
  hour: string;
  mile: string;
  hourLabel: string;
  mileLabel: string;
  verdict: string;
  reason: string;
  detail: string;
  background: string;
  foreground: string;
  durationMs: number;
  position: 'top' | 'center';
}

export const HOUR_LABEL = 'NET / HOUR';
export const MILE_LABEL = 'NET / MILE';

export function buildOverlay(grade: GradeResult, offer: ParsedOffer, s: OverlaySettings): OverlayContent {
  const durationMs = Math.round(s.seconds * 1000);
  if (!grade.gradable || !grade.verdict) {
    return {
      hour: '—',
      mile: '—',
      hourLabel: HOUR_LABEL,
      mileLabel: MILE_LABEL,
      verdict: 'CHECK',
      reason: grade.reason || "Couldn't read this card",
      detail: offer.fare != null ? `Fare read: ${money(offer.fare)} · check the card yourself` : 'Check the card yourself',
      ...VERDICT_COLORS.CHECK,
      durationMs,
      position: s.position,
    };
  }
  const detail =
    grade.flags.length > 0
      ? grade.flags.slice(0, 3).join(' · ')
      : `${money(grade.total ?? 0)} · ${grade.effMi?.toFixed(1)} mi · ${Math.round(grade.effMin ?? 0)} min all-in`;
  return {
    hour: formatPerHour(grade.netPerHour),
    mile: formatPerMile(grade.netPerMile),
    hourLabel: HOUR_LABEL,
    mileLabel: MILE_LABEL,
    verdict: grade.verdict,
    reason: grade.reason,
    detail,
    ...VERDICT_COLORS[grade.verdict],
    durationMs,
    position: s.position,
  };
}
