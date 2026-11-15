import type { GradeResult, GradingSettings, ParsedOffer, Verdict, Zone } from './types';
import { matchZone } from './zones';

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
export const money = (n: number) => `$${n.toFixed(2)}`;
/** "$36/hr" — the first headline number. */
const perHr = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n))}/hr`;
/** "68¢/mi" under a dollar, "$1.42/mi" from a dollar up — the second headline number. */
const perMi = (n: number) => {
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  const cents = Math.round(a * 100);
  return cents < 100 ? `${sign}${cents}¢/mi` : `${sign}$${a.toFixed(2)}/mi`;
};

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
>;

/**
 * Grading math
 * ------------
 *   total    = fare (+ separately shown bonus, if enabled and not "included")
 *   effMi    = pickupMi + tripMi (+ deadZoneExtraMiles if the dropoff is a dead zone)
 *   effMin   = pickupMin + tripMin (+ deadZoneExtraMinutes if dead zone)
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
 */
export function gradeOffer(offer: GradeInput, settings: GradingSettings, zones: Zone[]): GradeResult {
  const zone = matchZone(offer.dropoffArea, zones);
  const flags: string[] = [];
  const estimated: Array<'tripMi' | 'tripMin'> = [];

  const empty = (reason: string): GradeResult => ({
    gradable: false,
    verdict: null,
    reason,
    flags,
    total: null,
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

  let tripMi = offer.tripMi;
  let tripMin = offer.tripMin;
  const mph = Math.max(5, settings.assumedAvgMph);
  if (tripMi == null && tripMin == null) return empty("Couldn't read trip length");
  if (tripMi == null && tripMin != null) {
    tripMi = (tripMin / 60) * mph;
    estimated.push('tripMi');
    flags.push('Trip miles estimated');
  }
  if (tripMin == null && tripMi != null) {
    tripMin = (tripMi / mph) * 60;
    estimated.push('tripMin');
    flags.push('Trip minutes estimated');
  }
  const pickupMi = offer.pickupMi ?? 0;
  const pickupMin = offer.pickupMin ?? 0;
  if (offer.pickupMi == null && offer.pickupMin == null) flags.push('Pickup not read');

  let total = offer.fare;
  if (settings.addSeparateBonus && offer.surge != null && offer.surge > 0 && !offer.surgeIncluded) {
    total += offer.surge;
  }

  const penaltyApplied = zone.zoneClass === 'dead';
  const effMi = pickupMi + (tripMi as number) + (penaltyApplied ? settings.deadZoneExtraMiles : 0);
  const effMin = pickupMin + (tripMin as number) + (penaltyApplied ? settings.deadZoneExtraMinutes : 0);
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
  const tripMinutes = tripMin as number;
  const tripMiles = tripMi as number;
  if (tripMinutes >= settings.longTripMinutes || tripMiles >= settings.longTripMiles) {
    flags.unshift(`Long trip (${Math.round(tripMinutes)} min, ${tripMiles.toFixed(1)} mi)`);
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
        : `Dead-zone dropoff: ${zone.keyword} (+${settings.deadZoneExtraMinutes} min, +${settings.deadZoneExtraMiles} mi to get back)`;
  } else if (verdict === 'BAD') {
    // $/hr leads, so it is named first when both are under the floor.
    reason = badHr
      ? `Net ${perHr(netPerHour)} is under your ${perHr(settings.badBelowNetPerHour)} floor`
      : `Net ${perMi(netPerMile)} is under your ${perMi(settings.badBelowNetPerMile)} floor`;
  } else if (verdict === 'GREAT') {
    reason = `Clears ${perHr(settings.greatMinNetPerHour)} and ${perMi(settings.greatMinNetPerMile)} net`;
  } else {
    const misses: string[] = [];
    if (!greatHr) misses.push('$/hour');
    if (!greatMi) misses.push('per-mile');
    reason = `Fair ride: ${misses.join(' and ')} below Great`;
  }

  return {
    gradable: true,
    verdict,
    reason,
    flags,
    total: round(total),
    effMi: round(effMi, 1),
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

export function formatPerMile(n: number | null): string {
  return n == null ? '—' : perMi(n);
}
export function formatPerHour(n: number | null): string {
  return n == null ? '—' : perHr(n);
}
