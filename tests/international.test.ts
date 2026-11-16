import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCurrency, normalizeDecimalCommas, normalizeDigits, parseLocaleNumber, scanMoney } from '../src/ocr/locale';
import { normalizeLine, parseCard, metricPairs } from '../src/ocr/parser';
import { evaluateInput } from '../src/engine/evaluate';
import {
  defaultProfile,
  dollarCurrencyFor,
  formatDistance,
  formatFor,
  formatMoney,
  formatPerDistance,
  formatPerHour,
  KM_PER_MI,
  MARKETS,
  niceRound,
  recordFormat,
  resolveMarket,
  US_PROFILE,
} from '../src/engine/market';
import { DEFAULT_SETTINGS, DEFAULT_ZONES } from '../src/config/defaults';
import { gradingFor, normalizeSettings } from '../src/config/validate';
import { gradeOffer } from '../src/engine/grading';
import { card } from './fixtures';
import { EG_UBER_ARABIC, EU_SUFFIX, EU_UBER, UK_UBER } from './fixtures-intl';

const near = (a: number | null, b: number, eps = 0.002) => assert.ok(a != null && Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

// --- Numbers ------------------------------------------------------------------------------

test('Arabic-Indic and Persian digits become ASCII, with Arabic separators', () => {
  assert.equal(normalizeDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
  assert.equal(normalizeDigits('۰۱۲۳۴۵۶۷۸۹'), '0123456789');
  assert.equal(normalizeDigits('١٢٫٥٠'), '12.50');
  assert.equal(normalizeDigits('١٬٢٣٤٫٥'), '1,234.5');
});

test('decimal commas are read as decimals; thousands separators are not', () => {
  assert.equal(normalizeDecimalCommas('€12,50'), '€12.50');
  assert.equal(normalizeDecimalCommas('1.234,50 €'), '1234.50 €');
  assert.equal(normalizeDecimalCommas('4,9 ★'), '4.9 ★');
  assert.equal(normalizeDecimalCommas('$1,234'), '$1,234');
  assert.equal(parseLocaleNumber('12,50'), 12.5);
  assert.equal(parseLocaleNumber('1.234,50'), 1234.5);
  assert.equal(parseLocaleNumber('1,234.50'), 1234.5);
  assert.equal(parseLocaleNumber('1,234'), 1234);
  assert.equal(parseLocaleNumber('١٢٫٥'), 12.5);
  assert.equal(parseLocaleNumber('۳۴'), 34);
  assert.equal(parseLocaleNumber('1.234.567'), 1234567);
  assert.equal(parseLocaleNumber('abc'), null);
});

test('normalizeLine handles km with decimal comma and Arabic text', () => {
  assert.equal(normalizeLine('4 min (1,2 km) away'), '4 min (1.2 km) away');
  assert.equal(normalizeLine('٥ دقائق (٢٫٣ كم)'), '5 دقائق (2.3 كم)');
  assert.equal(normalizeLine('€ 9,80'), '€9.80');
});

test('distances in km are converted to miles; Arabic units are understood', () => {
  const [p] = metricPairs('4 min (1.2 km) away');
  assert.equal(p.min, 4);
  near(p.mi, 1.2 / KM_PER_MI);
  const [a] = metricPairs('22 دقيقة (11.4 كم) رحلة');
  assert.equal(a.min, 22);
  near(a.mi, 11.4 / KM_PER_MI);
  const [m] = metricPairs('3 min (800 m)');
  near(m.mi, 0.8 / KM_PER_MI);
});

// --- Money & currency -----------------------------------------------------------------------

test('money in any currency, symbol before or after, plus-bonus kept', () => {
  const one = (s: string) => scanMoney(s)[0];
  assert.deepEqual([one('€12.50').value, one('€12.50').currency], [12.5, 'EUR']);
  assert.deepEqual([one('12.50 €').value, one('12.50 €').currency], [12.5, 'EUR']);
  assert.equal(one('£8.40').currency, 'GBP');
  assert.equal(one('EGP 85').currency, 'EGP');
  assert.equal(one('85.00 ج.م').currency, 'EGP');
  assert.equal(one('SAR 23.50').currency, 'SAR');
  assert.equal(one('₹240').currency, 'INR');
  assert.equal(one('R$ 18.90').currency, 'BRL');
  assert.equal(one('US$12').currency, 'USD');
  const bonus = one('+£1.50 Boost');
  assert.equal(bonus.plus, true);
  assert.equal(bonus.value, 1.5);
  // A bare "$" follows the home market's dollar.
  assert.equal(one('$14.20').currency, 'USD');
  assert.equal(scanMoney('$14.20', 'CAD')[0].currency, 'CAD');
});

test('road names and stray letters are not money', () => {
  assert.deepEqual(scanMoney('Exit SR 7, Leesburg'), []);
  assert.deepEqual(scanMoney('4.93 ★'), []);
  assert.deepEqual(scanMoney('sale 12'), []);
  assert.equal(scanMoney('SR 23.50')[0].currency, 'SAR');
});

test('card currency: explicit codes outvote a bare $', () => {
  assert.equal(detectCurrency(['UberX', '$18.42']), 'USD');
  assert.equal(detectCurrency(['€12.50', '+$2.00']), 'EUR');
  assert.equal(detectCurrency(['$9.00'], 'AUD'), 'AUD');
  assert.equal(detectCurrency(['5 min (1.2 mi)']), null);
});

// --- Full international cards -----------------------------------------------------------------

test('Eurozone card: €, decimal commas, km, rating; accented name stripped', () => {
  const p = parseCard(card(EU_UBER));
  assert.equal(p.currency, 'EUR');
  assert.equal(p.distanceUnit, 'km');
  assert.equal(p.fare, 12.5);
  assert.equal(p.riderRating, 4.91);
  assert.equal(p.pickupMin, 4);
  near(p.pickupMi, 1.2 / KM_PER_MI);
  assert.equal(p.tripMin, 18);
  near(p.tripMi, 9.8 / KM_PER_MI);
  assert.equal(p.dropoffArea, 'Alexanderplatz, Berlin');
  assert.ok(!/zoë|zoe/i.test(p.rawText), p.rawText);
});

test('Egypt card with Arabic-Indic numerals and Arabic units', () => {
  const p = parseCard(card(EG_UBER_ARABIC));
  assert.equal(p.currency, 'EGP');
  assert.equal(p.distanceUnit, 'km');
  assert.equal(p.fare, 125.5);
  assert.equal(p.riderRating, 4.87);
  assert.equal(p.pickupMin, 5);
  near(p.pickupMi, 2.3 / KM_PER_MI);
  assert.equal(p.tripMin, 22);
  near(p.tripMi, 11.4 / KM_PER_MI);
  assert.equal(p.dropoffArea, 'مدينة نصر, القاهرة');
  assert.ok(!p.rawText.includes('أحمد'), p.rawText);
  assert.ok(p.rawText.includes('[rider]'));
});

test('UK card: pounds, miles, separate boost', () => {
  const p = parseCard(card(UK_UBER));
  assert.equal(p.currency, 'GBP');
  assert.equal(p.distanceUnit, 'mi');
  assert.equal(p.fare, 8.4);
  assert.equal(p.surge, 1.5);
  assert.equal(p.riderRating, 4.95);
  assert.equal(p.tripMi, 6.2);
});

test('suffix euro amounts parse ("32,40 €")', () => {
  const p = parseCard(card(EU_SUFFIX));
  assert.equal(p.fare, 32.4);
  assert.equal(p.currency, 'EUR');
  assert.equal(p.riderRating, 4.88);
});

// --- Markets & settings ---------------------------------------------------------------------

test('US market keeps the exact default thresholds', () => {
  assert.deepEqual(defaultProfile('US'), US_PROFILE);
  assert.deepEqual(US_PROFILE, {
    costPerUnit: 0.3,
    greatMinNetPerUnit: 1.25,
    greatMinNetPerHour: 30,
    badBelowNetPerUnit: 0.8,
    badBelowNetPerHour: 18,
  });
  const g = gradingFor(normalizeSettings({}), 'US');
  assert.equal(g.greatMinNetPerMile, 1.25);
  assert.equal(g.greatMinNetPerHour, 30);
  assert.equal(g.badBelowNetPerMile, 0.8);
  assert.equal(g.badBelowNetPerHour, 18);
});

test('other markets convert the defaults by currency and per-km', () => {
  for (const m of MARKETS) {
    const p = defaultProfile(m.code);
    assert.ok(p.badBelowNetPerUnit < p.greatMinNetPerUnit, m.code);
    assert.ok(p.badBelowNetPerHour < p.greatMinNetPerHour, m.code);
    assert.ok(p.costPerUnit > 0, m.code);
  }
  // Egypt: EGP per km. $1.25/mi ÷ 1.609 × 47.5 ≈ 36.9 → 37; $30/hr × 47.5 = 1425 → 1400.
  const eg = defaultProfile('EG');
  assert.equal(eg.greatMinNetPerUnit, niceRound((1.25 / KM_PER_MI) * 47.5));
  assert.equal(eg.greatMinNetPerHour, 1400);
  // UK stays in miles.
  assert.equal(formatFor('GB').unit, 'mi');
  assert.equal(formatFor('EG').unit, 'km');
});

test('per-km thresholds are converted to per-mile for the engine', () => {
  const s = normalizeSettings({
    settingsVersion: 2,
    market: { home: 'EU', profiles: { EU: { costPerUnit: 0.2, greatMinNetPerUnit: 0.8, greatMinNetPerHour: 28, badBelowNetPerUnit: 0.5, badBelowNetPerHour: 16 } } },
  });
  const g = gradingFor(s, 'EU');
  near(g.costPerMile, 0.2 * KM_PER_MI, 1e-9);
  near(g.greatMinNetPerMile, 0.8 * KM_PER_MI, 1e-9);
  assert.equal(g.greatMinNetPerHour, 28);
  // grading mirrors the home market
  near(s.grading.greatMinNetPerMile, 0.8 * KM_PER_MI, 1e-9);
});

test('verdict is unit-invariant: the same ride graded in mi or km gives the same answer', () => {
  const offer = {
    fare: 20, surge: null, surgeIncluded: false, pickupMi: 2, pickupMin: 6, tripMi: 10, tripMin: 20,
    dropoffArea: 'Fairfax', riderRating: 4.9, offerType: 'UberX', multiStop: false,
  };
  const mi = gradeOffer(offer, gradingFor(DEFAULT_SETTINGS, 'US'), DEFAULT_ZONES);
  const km = { ...DEFAULT_SETTINGS, market: { home: 'CA' as const, autoDetect: true, profiles: {
    CA: {
      costPerUnit: 0.3 / KM_PER_MI, greatMinNetPerUnit: 1.25 / KM_PER_MI, greatMinNetPerHour: 30,
      badBelowNetPerUnit: 0.8 / KM_PER_MI, badBelowNetPerHour: 18,
    } } } };
  const k = gradeOffer(offer, gradingFor(km, 'CA'), DEFAULT_ZONES, formatFor('CA'));
  assert.equal(k.verdict, mi.verdict);
  near(k.netPerMile, mi.netPerMile ?? 0, 0.011);
  assert.equal(k.netPerHour, mi.netPerHour);
});

test('market resolution: home, auto-detected currency, edited profile preferred', () => {
  const ms = { home: 'US' as const, autoDetect: true, profiles: {} };
  assert.equal(resolveMarket(ms, null), 'US');
  assert.equal(resolveMarket(ms, 'USD'), 'US');
  assert.equal(resolveMarket(ms, 'EUR'), 'EU');
  assert.equal(resolveMarket({ ...ms, profiles: { IE: defaultProfile('IE') } }, 'EUR'), 'IE');
  assert.equal(resolveMarket(ms, 'EGP'), 'EG');
  assert.equal(resolveMarket({ ...ms, autoDetect: false }, 'EGP'), 'US');
  assert.equal(dollarCurrencyFor('CA'), 'CAD');
  assert.equal(dollarCurrencyFor('EG'), 'USD');
});

test('end to end: US driver gets an EGP card → graded with Egypt settings, shown in E£ per km', () => {
  const ev = evaluateInput(card(EG_UBER_ARABIC), DEFAULT_SETTINGS, DEFAULT_ZONES);
  assert.equal(ev.market, 'EG');
  assert.equal(ev.fmt.currency, 'EGP');
  assert.equal(ev.fmt.unit, 'km');
  assert.ok(ev.grade.gradable);
  assert.match(ev.grade.reason, /E£|\/km|km/);
  // Canadian home: a bare $ is CAD and the card grades with Canadian settings.
  const ca = normalizeSettings({ settingsVersion: 2, market: { home: 'CA' } });
  const c = evaluateInput(card('UberX\n$14.20\n★ 4.90\n5 min (3.0 km) away\nA St\n15 min (12.0 km) trip\nB Ave\nAccept'), ca, DEFAULT_ZONES);
  assert.equal(c.parsed.currency, 'CAD');
  assert.equal(c.market, 'CA');
});

// --- Formatting -----------------------------------------------------------------------------

test('money and rate formatting per currency, unit and decimal style', () => {
  assert.equal(formatMoney(18.42), '$18.42');
  assert.equal(formatMoney(12.5, formatFor('EU')), '€12,50');
  assert.equal(formatMoney(85.5, formatFor('EG')), 'E£85.50');
  assert.equal(formatMoney(1.25, formatFor('KW')), 'KD 1.250');
  assert.equal(formatMoney(12.5, formatFor('PL')), '12,50 zł');
  assert.equal(formatPerHour(27.6, formatFor('GB')), '£28/hr');
  assert.equal(formatPerHour(9.46, formatFor('KW')), 'KD 9.5/hr');
  assert.equal(formatPerDistance(0.45, formatFor('GB')), '45p/mi');
  assert.equal(formatPerDistance(0.88 * KM_PER_MI, formatFor('EU')), '€0,88/km');
  assert.equal(formatPerDistance(0.5 * KM_PER_MI, formatFor('IE')), '50c/km');
  assert.equal(formatPerDistance(23.6 * KM_PER_MI, formatFor('EG')), 'E£23.60/km');
  assert.equal(formatDistance(13.6), '13.6 mi');
  assert.equal(formatDistance(13.6, formatFor('EU')), '21,9 km');
  // Old records (no currency/unit stored) still show as dollars and miles.
  assert.deepEqual(recordFormat({}), { currency: 'USD', unit: 'mi', decimalComma: false });
  assert.equal(recordFormat({ market: 'EU', currency: 'EUR', distanceUnit: 'km' }).decimalComma, true);
});
