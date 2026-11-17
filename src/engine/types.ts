// Core domain types. This folder is pure TypeScript (no React Native imports) so it
// can be unit-tested in plain Node — see scripts/run-tests.mjs.

import type { CurrencyCode, DistanceUnit } from './market';

export type Platform = 'uber' | 'lyft' | 'unknown';
export type Verdict = 'GREAT' | 'OK' | 'BAD';
export type ZoneClass = 'hot' | 'neutral' | 'dead';
export type ReadPath = 'primary' | 'fallback';

export interface CardLineInput {
  text: string;
  /** Normalized 0..1 relative to the detected card box. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CardInput {
  text: string;
  lines: CardLineInput[];
  pass?: 'crop' | 'frame';
}

export type OfferField =
  | 'fare'
  | 'surge'
  | 'pickupMi'
  | 'pickupMin'
  | 'tripMi'
  | 'tripMin'
  | 'totalMi'
  | 'totalMin'
  | 'pickupArea'
  | 'dropoffArea'
  | 'riderRating'
  | 'offerType';

export interface ParsedOffer {
  platform: Platform;
  fare: number | null;
  surge: number | null;
  /** True when the card says the bonus is already included in the fare. */
  surgeIncluded: boolean;
  pickupMi: number | null;
  pickupMin: number | null;
  tripMi: number | null;
  tripMin: number | null;
  /**
   * Total distance/time exactly as the card states it ("Total 26 min · 12.4 mi"), or
   * null when the card shows no total line. Grading always uses pickup + trip; this is
   * used to fill in a missing leg and to grade cards that only show a total.
   */
  totalMi: number | null;
  totalMin: number | null;
  pickupArea: string | null;
  dropoffArea: string | null;
  /** Rider's star rating (1–5). The rider's NAME is never read into any field. */
  riderRating: number | null;
  offerType: string | null;
  /** Currency the card is shown in (auto-detected from "$", "€", "EGP"…), or null. */
  currency: CurrencyCode | null;
  /** Distance unit the card uses. All distances above are converted to MILES. */
  distanceUnit: DistanceUnit | null;
  multiStop: boolean;
  stopCount: number | null;
  readPath: ReadPath;
  /** Fields whose primary (region) read was empty/implausible and came from the full-card pattern scan. */
  fallbackFields: OfferField[];
  /** 0..1 */
  confidence: number;
  /** Card OCR text with rider-name tokens removed. */
  rawText: string;
}

export interface Zone {
  id: string;
  keyword: string;
  zoneClass: ZoneClass;
}

export interface ZoneMatch {
  zoneClass: ZoneClass;
  keyword: string | null;
}

export interface GradingSettings {
  /** Vehicle cost per mile driven (fuel, maintenance, tires, depreciation). */
  costPerMile: number;
  greatMinNetPerMile: number;
  greatMinNetPerHour: number;
  badBelowNetPerMile: number;
  badBelowNetPerHour: number;
  deadZoneExtraMinutes: number;
  deadZoneExtraMiles: number;
  longTripMinutes: number;
  longTripMiles: number;
  longPickupMinutes: number;
  lowRatingBelow: number;
  /** Add a bonus shown as "+$X" (not marked included) on top of the fare. */
  addSeparateBonus: boolean;
  /** Used only to estimate a missing miles/minutes value. */
  assumedAvgMph: number;
}

export interface GradeResult {
  gradable: boolean;
  verdict: Verdict | null;
  reason: string;
  flags: string[];
  total: number | null;
  /** Pickup + trip, the distance/time of the whole job (no dead-zone penalty). */
  totalMi: number | null;
  totalMin: number | null;
  /** Total + dead-zone return. ALL rates and the verdict are computed on this. */
  effMi: number | null;
  effMin: number | null;
  cost: number | null;
  net: number | null;
  grossPerMile: number | null;
  grossPerHour: number | null;
  netPerMile: number | null;
  netPerHour: number | null;
  zone: ZoneMatch;
  penaltyApplied: boolean;
  estimated: Array<'tripMi' | 'tripMin'>;
}

export type WaitEndedBy = 'offer' | 'trip_started' | 'stopped';
export type WaitStartedBy = 'online' | 'dropoff' | 'declined';

export interface WaitRecord {
  zoneText: string | null;
  startTs: number;
  durationSec: number;
  endedBy: WaitEndedBy;
  startedBy: WaitStartedBy;
}
