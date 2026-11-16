import type { AppSettings } from '../config/defaults';
import { gradingFor } from '../config/validate';
import { parseCard } from '../ocr/parser';
import { gradeOffer } from './grading';
import { dollarCurrencyFor, formatFor, resolveMarket, type MarketCode, type MoneyFormat } from './market';
import type { OfferRecord } from './records';
import type { CardInput, GradeResult, ParsedOffer, Zone } from './types';

/**
 * Card text → parsed offer → market → grade. Pure, so the whole decision path (currency
 * detection, market choice, unit conversion, total-distance math) is unit-tested.
 */
export interface Evaluation {
  parsed: ParsedOffer;
  grade: GradeResult;
  /** Market whose settings graded this card. */
  market: MarketCode;
  /** How to show this offer's money and distances. */
  fmt: MoneyFormat;
}

export function evaluateInput(input: CardInput, settings: AppSettings, zones: Zone[]): Evaluation {
  const parsed = parseCard(input, {
    safeWords: zones.map((z) => z.keyword),
    dollarCurrency: dollarCurrencyFor(settings.market.home),
  });
  return gradeParsed(parsed, settings, zones);
}

/** Grades an already-parsed (or hand-entered) offer with the right market's settings. */
export function gradeParsed(parsed: ParsedOffer, settings: AppSettings, zones: Zone[]): Evaluation {
  const market = resolveMarket(settings.market, parsed.currency);
  const fmt = formatFor(market);
  const grade = gradeOffer(parsed, gradingFor(settings, market), zones, fmt);
  return { parsed, grade, market, fmt };
}

/** The row saved to History. Rider rating is kept; a rider's name has no field to go in. */
export function toRecord(ev: Evaluation, ts: number, sessionId: number | null): Omit<OfferRecord, 'id' | 'synced'> {
  const { parsed: p, grade: g } = ev;
  return {
    sessionId,
    ts,
    platform: p.platform,
    fare: p.fare,
    surge: p.surge,
    surgeIncluded: p.surgeIncluded,
    total: g.total,
    pickupMi: p.pickupMi,
    pickupMin: p.pickupMin,
    tripMi: p.tripMi,
    tripMin: p.tripMin,
    totalMi: g.totalMi,
    totalMin: g.totalMin,
    pickupArea: p.pickupArea,
    dropoffArea: p.dropoffArea,
    riderRating: p.riderRating,
    offerType: p.offerType,
    currency: ev.fmt.currency,
    distanceUnit: ev.fmt.unit,
    market: ev.market,
    multiStop: p.multiStop,
    zoneClass: g.zone.zoneClass,
    zoneKeyword: g.zone.keyword,
    effMi: g.effMi,
    effMin: g.effMin,
    cost: g.cost,
    net: g.net,
    grossPerMile: g.grossPerMile,
    grossPerHour: g.grossPerHour,
    netPerMile: g.netPerMile,
    netPerHour: g.netPerHour,
    verdict: g.verdict,
    reason: g.reason,
    flags: g.flags,
    confidence: p.confidence,
    readPath: p.readPath,
    fallbackFields: p.fallbackFields,
    rawText: p.rawText,
  };
}
