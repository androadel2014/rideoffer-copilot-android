import {
  formatDistance,
  formatMoney,
  formatPerDistance,
  formatPerHour as fmtHour,
  US_FORMAT,
  type MoneyFormat,
} from './market';
import type { GradeResult, GradingSettings, ParsedOffer, Verdict, Zone } from './types';
import { matchZone } from './zones';

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
export const money = (n: number, f: MoneyFormat = US_FORMAT) => formatMoney(n, f);
/** "$36/hr" — the first headline number. */
const perHr = (n: number, f: MoneyFormat) => fmtHour(n, f);
/** "68¢/mi" under a dollar, "$1.42/mi" from a dollar up, "€0,44/km" — the second headline number. */
const perMi = (n: number, f: MoneyFormat) => formatPerDistance(n, f);

type GradeInput = Pick<
  ParsedOffer,
  | 'fare'
  | 'surge'
  | 'surgeIncluded'
  | 'pickupMi'
  | 'pickupMin'
  | 'tripMi'
  | 'tripMin'
  | 'dropoffArea'
  | 'riderRating'
  | 'offerType'
  | 'multiStop'
> &
  Partial<Pick<ParsedOffer, 'totalMi' | 'totalMin'>>;

/**
 * Grading math
 * ------------
 *   total    = fare (+ separately shown bonus, if enabled and not "included")
 *   totalMi  = pickupMi + tripMi             ← TOTAL distance of the job
 *   totalMin = pickupMin + tripMin
 *              (a card that shows only a "Total" line is graded on that total)
 *   effMi    = totalMi  (+ deadZoneExtraMiles if the dropoff is a dead zone)
 *   effMin   = totalMin (+ deadZoneExtraMinutes if dead zone)
 *   cost     = costPerMile × effMi
 *   net      = total − cost
 *   gross/mi = total / effMi        gross/hr = total / (effMin / 60)
 *   net/mi   = net / effMi          net/hr   = net / (effMin / 60)
 *
 *   GREAT  ⇔ net/mi ≥ greatMinNetPerMile AND net/hr ≥ greatMinNetPerHour
 *   BAD    ⇔ net/mi < badBelowNetPerMile OR  net/hr < badBelowNetPerHour
 *   OK     otherwise
 *
 * Both rates must be good for GREAT, either being bad makes it BAD: a ride that pays
 * well per mile but crawls through traffic, or pays well per hour but burns miles,
 * is not a great ride.
 *
 * Every rate uses the TOTAL distance and time (never the trip leg alone). Distances are
 * miles and rates are per mile internally; `fmt` only changes how the reason text shows
 * them (currency, mi/km, decimal comma). `settings` must already be per mile in the
 * offer's currency — build it with gradingFor() in config/validate.
 */
export function gradeOffer(
  offer: GradeInput,
  settings: GradingSettings,
  zones: Zone[],
  fmt: MoneyFormat = US_FORMAT
): GradeResult {
  const zone = matchZone(offer.dropoffArea, zones);
  const flags: string[] = [];
  const estimated: Array<'tripMi' | 'tripMin'> = [];

  const empty = (reason: string): GradeResult => ({
    gradable: false,
    verdict: null,
    reason,
    flags,
    total: null,
    totalMi: null,
    totalMin: null,
    effMi: null,
    effMin: null,
    cost: null,
    net: null,
    grossPerMile: null,
    grossPerHour: null,
    netPerMile: null,
    netPerHour: null,
    zone,
    penaltyApplied: false,
    estimated,
  });

  if (offer.fare == null || !(offer.fare > 0)) return empty("Couldn't read the fare");

  const mph = Math.max(5, settings.assumedAvgMph);
  let tripMi = offer.tripMi;
  let tripMin = offer.tripMin;
  const cardTotalMi = offer.totalMi ?? null;
  const cardTotalMin = offer.totalMin ?? null;
  const hasTrip = tripMi != null || tripMin != null;
  const hasCardTotal = cardTotalMi != null || cardTotalMin != null;
  if (!hasTrip && !hasCardTotal) return empty("Couldn't read trip length");

  let total = offer.fare;
  if (settings.addSeparateBonus && offer.surge != null && offer.surge > 0 && !offer.surgeIncluded) {
    total += offer.surge;
  }

  let totalMi: number;
  let totalMin: number;
  if (hasTrip) {
    if (tripMi == null && tripMin != null) {
      tripMi = (tripMin / 60) * mph;
      estimated.push('tripMi');
      flags.push(fmt.unit === 'km' ? 'Trip km estimated' : 'Trip miles estimated');
    }
    if (tripMin == null && tripMi != null) {
      tripMin = (tripMi / mph) * 60;
      estimated.push('tripMin');
      flags.push('Trip minutes estimated');
    }
    if (offer.pickupMi == null && offer.pickupMin == null) flags.push('Pickup not read');
    // TOTAL distance and time = pickup leg + trip leg.
    totalMi = (offer.pickupMi ?? 0) + (tripMi as number);
    totalMin = (offer.pickupMin ?? 0) + (tripMin as number);
  } else {
    // Only a "Total" line could be read: grade on the card's own total.
    totalMi = cardTotalMi ?? ((cardTotalMin as number) / 60) * mph;
    totalMin = cardTotalMin ?? ((cardTotalMi as number) / mph) * 60;
    flags.push('Graded on card total');
  }

  const penaltyApplied = zone.zoneClass === 'dead';
  const effMi = totalMi + (penaltyApplied ? settings.deadZoneExtraMiles : 0);
  const effMin = totalMin + (penaltyApplied ? settings.deadZoneExtraMinutes : 0);
  if (!(effMi > 0) || !(effMin > 0)) return empty("Couldn't read trip length");

  const cost = settings.costPerMile * effMi;
  const net = total - cost;
  const hours = effMin / 60;
  const grossPerMile = total / effMi;
  const grossPerHour = total / hours;
  const netPerMile = net / effMi;
  const netPerHour = net / hours;

  // --- Tier ---
  const greatMi = netPerMile >= settings.greatMinNetPerMile;
  const greatHr = netPerHour >= settings.greatMinNetPerHour;
  const badMi = netPerMile < settings.badBelowNetPerMile;
  const badHr = netPerHour < settings.badBelowNetPerHour;
  let verdict: Verdict = badMi || badHr ? 'BAD' : greatMi && greatHr ? 'GREAT' : 'OK';

  // --- Flags (shown under the reason) ---
  const tripMinutes = tripMin ?? totalMin;
  const tripMiles = tripMi ?? totalMi;
  if (tripMinutes >= settings.longTripMinutes || tripMiles >= settings.longTripMiles) {
    flags.unshift(`Long trip (${Math.round(tripMinutes)} min, ${formatDistance(tripMiles, fmt)})`);
  }
  if (offer.pickupMin != null && offer.pickupMin >= settings.longPickupMinutes) {
    flags.push(`Long pickup (${Math.round(offer.pickupMin)} min)`);
  }
  if (offer.multiStop) flags.push('Multi-stop');
  if (offer.offerType && /share|shared|wait\s*&?\s*save/i.test(offer.offerType)) flags.push('Shared ride');
  if (offer.riderRating != null && offer.riderRating < settings.lowRatingBelow) {
    flags.push(`Rider ${offer.riderRating.toFixed(2)}★`);
  }
  if (zone.zoneClass === 'hot') flags.push(`Hot-zone dropoff (${zone.keyword})`);

  // --- Human reason (one line, most important cause first) ---
  let reason: string;
  if (penaltyApplied) {
    reason =
      verdict === 'GREAT'
        ? `Dead-zone dropoff: ${zone.keyword}, still Great after the return trip`
        : `Dead-zone dropoff: ${zone.keyword} (+${settings.deadZoneExtraMinutes} min, +${formatDistance(settings.deadZoneExtraMiles, fmt).replace(/[.,]0 /, ' ')} to get back)`;
  } else if (verdict === 'BAD') {
    // $/hr leads, so it is named first when both are under the floor.
    reason = badHr
      ? `Net ${perHr(netPerHour, fmt)} is under your ${perHr(settings.badBelowNetPerHour, fmt)} floor`
      : `Net ${perMi(netPerMile, fmt)} is under your ${perMi(settings.badBelowNetPerMile, fmt)} floor`;
  } else if (verdict === 'GREAT') {
    reason = `Clears ${perHr(settings.greatMinNetPerHour, fmt)} and ${perMi(settings.greatMinNetPerMile, fmt)} net`;
  } else {
    const misses: string[] = [];
    if (!greatHr) misses.push('$/hour');
    if (!greatMi) misses.push(fmt.unit === 'km' ? 'per-km' : 'per-mile');
    reason = `Fair ride: ${misses.join(' and ')} below Great`;
  }

  return {
    gradable: true,
    verdict,
    reason,
    flags,
    total: round(total),
    // Miles keep 3 decimals so km markets display exactly what the card said.
    totalMi: round(totalMi, 3),
    totalMin: round(totalMin, 0),
    effMi: round(effMi, 3),
    effMin: round(effMin, 0),
    cost: round(cost),
    net: round(net),
    grossPerMile: round(grossPerMile),
    grossPerHour: round(grossPerHour, 1),
    netPerMile: round(netPerMile),
    netPerHour: round(netPerHour, 1),
    zone,
    penaltyApplied,
    estimated,
  };
}

export const VERDICT_COLORS: Record<Verdict | 'CHECK', { background: string; foreground: string }> = {
  GREAT: { background: '#15803D', foreground: '#FFFFFF' },
  OK: { background: '#F5B300', foreground: '#111111' },
  BAD: { background: '#C8102E', foreground: '#FFFFFF' },
  CHECK: { background: '#3A4256', foreground: '#FFFFFF' },
};

export function formatPerMile(n: number | null, f: MoneyFormat = US_FORMAT): string {
  return n == null ? '—' : perMi(n, f);
}
export function formatPerHour(n: number | null, f: MoneyFormat = US_FORMAT): string {
  return n == null ? '—' : perHr(n, f);
}
