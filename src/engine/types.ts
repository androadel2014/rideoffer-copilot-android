// Core domain types. This folder is pure TypeScript (no React Native imports) so it
// can be unit-tested in plain Node — see scripts/run-tests.mjs.

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
  pickupArea: string | null;
  dropoffArea: string | null;
  riderRating: number | null;
  offerType: string | null;
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
