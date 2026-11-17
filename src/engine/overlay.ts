import type { OverlaySettings } from '../config/defaults';
import { formatPerHour, formatPerMile, money, VERDICT_COLORS } from './grading';
import { formatDistance, formatNumber, US_FORMAT, type DistanceUnit, type MoneyFormat } from './market';
import type { GradeResult, ParsedOffer } from './types';

/**
 * Overlay layout (top to bottom), built for a one-second glance:
 *
 *   NET / HOUR        NET / MILE        ← small labels
 *   $36/hr            68¢/mi            ← the two huge headline numbers
 *   [ GREAT ]  Clears $30/hr and $1.25/mi net   ← verdict + reason support them
 *   $18.42 · 15.4 mi · 27 min total · ★ 4.93     ← what the numbers are based on
 *   Long pickup (14 min) · Multi-stop           ← optional flags
 *
 * The card's background colour is the verdict colour, so the tier still reads instantly
 * even though the numbers lead.
 *
 * Placement: with position "card" (the default) the verdict floats ON TOP of the
 * Uber/Lyft offer card itself, anchored to the card's top edge as detected on screen.
 * When the card position is unknown it falls back to the top of the screen.
 */
export interface OverlayContent {
  hour: string;
  mile: string;
  hourLabel: string;
  mileLabel: string;
  verdict: string;
  reason: string;
  /** Flags (long pickup, multi-stop…), empty when there are none. */
  detail: string;
  /** Pay and TOTAL distance/time the rates are computed on. */
  meta: string;
  /** "★ 4.93", or "" when the card shows no rating. */
  rating: string;
  background: string;
  foreground: string;
  durationMs: number;
  position: 'card' | 'top' | 'center';
  /** Detected offer-card edges as fractions (0..1) of the screen height; −1 when unknown. */
  anchorTop: number;
  anchorBottom: number;
}

/** Where the offer card sits on screen, as fractions of the screen height. */
export interface OverlayAnchor {
  top: number;
  bottom: number;
}

export const HOUR_LABEL = 'NET / HOUR';
export const MILE_LABEL = 'NET / MILE';
export const KM_LABEL = 'NET / KM';
export const distanceLabel = (unit: DistanceUnit) => (unit === 'km' ? KM_LABEL : MILE_LABEL);

/** Validates a card anchor from the native layer; returns null if it is unusable. */
export function cleanAnchor(a: { top?: unknown; bottom?: unknown } | null | undefined): OverlayAnchor | null {
  if (!a) return null;
  const top = Number(a.top);
  const bottom = Number(a.bottom);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;
  if (top < 0 || bottom > 1.0001 || bottom - top < 0.05) return null;
  return { top, bottom: Math.min(1, bottom) };
}

export function ratingText(rating: number | null | undefined, f: MoneyFormat = US_FORMAT): string {
  return rating == null ? '' : `★ ${formatNumber(rating, 2, f)}`;
}

export function buildOverlay(
  grade: GradeResult,
  offer: ParsedOffer,
  s: OverlaySettings,
  fmt: MoneyFormat = US_FORMAT,
  anchor?: OverlayAnchor | null
): OverlayContent {
  const durationMs = Math.round(s.seconds * 1000);
  const a = s.position === 'card' ? cleanAnchor(anchor) : null;
  const place = {
    position: s.position,
    anchorTop: a ? a.top : -1,
    anchorBottom: a ? a.bottom : -1,
  };
  const rating = ratingText(offer.riderRating, fmt);
  if (!grade.gradable || !grade.verdict) {
    return {
      hour: '—',
      mile: '—',
      hourLabel: HOUR_LABEL,
      mileLabel: distanceLabel(fmt.unit),
      verdict: 'CHECK',
      reason: grade.reason || "Couldn't read this card",
      detail: offer.fare != null ? `Fare read: ${money(offer.fare, fmt)} · check the card yourself` : 'Check the card yourself',
      meta: '',
      rating,
      ...VERDICT_COLORS.CHECK,
      durationMs,
      ...place,
    };
  }
  const meta = [
    money(grade.total ?? 0, fmt),
    `${formatDistance(grade.totalMi, fmt)} · ${Math.round(grade.totalMin ?? 0)} min total`,
    grade.penaltyApplied ? `+ return (${formatDistance(grade.effMi, fmt)} all-in)` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    hour: formatPerHour(grade.netPerHour, fmt),
    mile: formatPerMile(grade.netPerMile, fmt),
    hourLabel: HOUR_LABEL,
    mileLabel: distanceLabel(fmt.unit),
    verdict: grade.verdict,
    reason: grade.reason,
    detail: grade.flags.slice(0, 3).join(' · '),
    meta,
    rating,
    ...VERDICT_COLORS[grade.verdict],
    durationMs,
    ...place,
  };
}
