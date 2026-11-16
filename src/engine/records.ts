import type { CurrencyCode, DistanceUnit, MarketCode } from './market';
import type { Platform, ReadPath, Verdict, WaitEndedBy, WaitStartedBy, ZoneClass } from './types';

/**
 * One detected offer as stored in SQLite (and exported / synced). Never contains rider
 * names: there is no name field, and every text field is sanitized before it gets here.
 *
 * Distances are MILES and rates are per MILE (canonical), in `currency`. `distanceUnit`
 * and `market` say how to show them. Records from before v11 have null currency/unit/
 * market and are shown as US dollars and miles (so these fields are optional).
 */
export interface OfferRecord {
  id: number;
  sessionId: number | null;
  ts: number;
  platform: Platform;
  fare: number | null;
  surge: number | null;
  surgeIncluded: boolean;
  total: number | null;
  pickupMi: number | null;
  pickupMin: number | null;
  tripMi: number | null;
  tripMin: number | null;
  /** Pickup + trip: the TOTAL distance/time every rate is computed on (before any dead-zone return). */
  totalMi?: number | null;
  totalMin?: number | null;
  pickupArea: string | null;
  dropoffArea: string | null;
  /** Rider's star rating as shown on the card (1–5). */
  riderRating: number | null;
  offerType: string | null;
  currency?: CurrencyCode | null;
  distanceUnit?: DistanceUnit | null;
  market?: MarketCode | null;
  multiStop: boolean;
  zoneClass: ZoneClass;
  zoneKeyword: string | null;
  effMi: number | null;
  effMin: number | null;
  cost: number | null;
  net: number | null;
  grossPerMile: number | null;
  grossPerHour: number | null;
  netPerMile: number | null;
  netPerHour: number | null;
  verdict: Verdict | null;
  reason: string;
  flags: string[];
  confidence: number;
  readPath: ReadPath;
  fallbackFields: string[];
  rawText: string;
  synced: boolean;
}

export interface WaitRow {
  id: number;
  sessionId: number | null;
  zoneText: string | null;
  startTs: number;
  durationSec: number;
  endedBy: WaitEndedBy;
  startedBy: WaitStartedBy;
  synced: boolean;
}

export interface SessionRow {
  id: number;
  startedAt: number;
  endedAt: number | null;
}

export interface Totals {
  offers: number;
  great: number;
  ok: number;
  bad: number;
  unreadable: number;
  avgNetPerMile: number | null;
  avgNetPerHour: number | null;
  sumFares: number;
  waits: number;
  waitSec: number;
  avgWaitSec: number | null;
}

export function computeTotals(offers: OfferRecord[], waits: WaitRow[]): Totals {
  const graded = offers.filter((o) => o.verdict != null);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const waitSec = waits.reduce((a, w) => a + w.durationSec, 0);
  return {
    offers: offers.length,
    great: offers.filter((o) => o.verdict === 'GREAT').length,
    ok: offers.filter((o) => o.verdict === 'OK').length,
    bad: offers.filter((o) => o.verdict === 'BAD').length,
    unreadable: offers.length - graded.length,
    avgNetPerMile: avg(graded.map((o) => o.netPerMile).filter((n): n is number => n != null)),
    avgNetPerHour: avg(graded.map((o) => o.netPerHour).filter((n): n is number => n != null)),
    sumFares: offers.reduce((a, o) => a + (o.total ?? 0), 0),
    waits: waits.length,
    waitSec,
    avgWaitSec: waits.length ? waitSec / waits.length : null,
  };
}
