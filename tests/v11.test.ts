import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeOffer } from '../src/engine/grading';
import { buildOverlay, cleanAnchor, KM_LABEL, MILE_LABEL } from '../src/engine/overlay';
import { evaluateInput, toRecord } from '../src/engine/evaluate';
import { formatFor, KM_PER_MI } from '../src/engine/market';
import { parseCard } from '../src/ocr/parser';
import { DEFAULT_GRADING, DEFAULT_SETTINGS, DEFAULT_ZONES } from '../src/config/defaults';
import { normalizeSettings } from '../src/config/validate';
import { offersToCsv, toJsonExport } from '../src/export/format';
import { buildBatch } from '../src/sync/payload';
import type { OfferRecord } from '../src/engine/records';
import { card, UBER_STANDARD, UBER_OCR_NOISE } from './fixtures';
import { EG_UBER_ARABIC, EU_UBER, LYFT_TOTAL_NO_PICKUP, LYFT_WITH_TOTAL, TOTAL_ONLY } from './fixtures-intl';

const base = {
  fare: 20,
  surge: null,
  surgeIncluded: false,
  pickupMi: 2,
  pickupMin: 6,
  tripMi: 10,
  tripMin: 20,
  dropoffArea: 'Fairfax',
  riderRating: 4.9,
  offerType: 'UberX',
  multiStop: false,
};

// --- Distance split: pickup / trip / total ---------------------------------------------------

test('total = pickup + trip, and every rate uses the TOTAL distance and time', () => {
  const g = gradeOffer(base, DEFAULT_GRADING, DEFAULT_ZONES);
  assert.equal(g.totalMi, 12);
  assert.equal(g.totalMin, 26);
  // net = 20 − 0.30 × 12 = 16.40; per mile on TOTAL (12), not the 10-mile trip leg.
  assert.equal(g.netPerMile, +(16.4 / 12).toFixed(2));
  assert.notEqual(g.netPerMile, +(17 / 10).toFixed(2));
  assert.equal(g.netPerHour, +((16.4 / 26) * 60).toFixed(1));
  // A longer pickup lowers the rates even though the trip is the same.
  const far = gradeOffer({ ...base, pickupMi: 8, pickupMin: 18 }, DEFAULT_GRADING, DEFAULT_ZONES);
  assert.equal(far.totalMi, 18);
  assert.ok((far.netPerMile ?? 0) < (g.netPerMile ?? 0));
});

test('dead-zone return is added on top of the total, not instead of it', () => {
  const g = gradeOffer({ ...base, dropoffArea: 'Warrenton' }, DEFAULT_GRADING, DEFAULT_ZONES);
  assert.equal(g.totalMi, 12);
  assert.equal(g.effMi, 12 + DEFAULT_GRADING.deadZoneExtraMiles);
});

test('default thresholds: GREAT needs ≥ $1.25/mi AND ≥ $30/hr; BAD is < $0.80/mi OR < $18/hr', () => {
  // 10 mi, 20 min total, no pickup: net = fare − 3.00
  const at = (fare: number, min = 20) =>
    gradeOffer({ ...base, fare, pickupMi: 0, pickupMin: 0, tripMi: 10, tripMin: min }, DEFAULT_GRADING, DEFAULT_ZONES);
  assert.equal(at(15.5).verdict, 'GREAT'); // $1.25/mi, $37.5/hr
  assert.equal(at(15.4).verdict, 'OK'); // $1.24/mi
  assert.equal(at(15.5, 26).verdict, 'OK'); // $1.25/mi but $28.8/hr
  assert.equal(at(11).verdict, 'OK'); // $0.80/mi, $24/hr
  assert.equal(at(10.9).verdict, 'BAD'); // $0.79/mi
  assert.equal(at(15.5, 42).verdict, 'BAD'); // $17.9/hr
});

test('parser: "Total" line is read separately and never mistaken for pickup or trip', () => {
  const p = parseCard(card(LYFT_WITH_TOTAL));
  assert.equal(p.pickupMin, 6);
  assert.equal(p.pickupMi, 2.1);
  assert.equal(p.tripMin, 21);
  assert.equal(p.tripMi, 10.4);
  assert.equal(p.totalMin, 27);
  assert.equal(p.totalMi, 12.5);
  assert.equal(p.riderRating, 4.9);
});

test('parser: a missing pickup leg is filled from total − trip', () => {
  const p = parseCard(card(LYFT_TOTAL_NO_PICKUP));
  assert.equal(p.pickupMi, 2.1);
  assert.equal(p.pickupMin, 6);
  assert.ok(p.fallbackFields.includes('pickupMi'));
  const g = gradeOffer(p, DEFAULT_GRADING, DEFAULT_ZONES);
  assert.equal(g.totalMi, 12.5);
  assert.ok(!g.flags.includes('Pickup not read'));
});

test('grading: a card that only shows a total is graded on that total', () => {
  const p = parseCard(card(TOTAL_ONLY));
  assert.equal(p.tripMi, null);
  assert.equal(p.totalMi, 14);
  assert.equal(p.totalMin, 30);
  const g = gradeOffer(p, DEFAULT_GRADING, DEFAULT_ZONES);
  assert.equal(g.gradable, true);
  assert.equal(g.totalMi, 14);
  assert.ok(g.flags.includes('Graded on card total'));
});

// --- Rider rating, never rider names ----------------------------------------------------------

test('rider rating is parsed in every common layout', () => {
  const r = (line: string) => parseCard(card(`UberX\n$12.00\n${line}\n5 min (1.0 mi) away\nA St\n10 min (4.0 mi) trip\nB Ave\nAccept`)).riderRating;
  assert.equal(r('★ 4.93'), 4.93);
  assert.equal(r('4.93 ★'), 4.93);
  assert.equal(r('4,93 ★'), 4.93);
  assert.equal(r('★ ٤٫٩٥'), 4.95);
  assert.equal(r('Sarah ★ 4.88'), 4.88);
  assert.equal(r('New rider'), null);
});

test('rating is stored with the logged offer; no rider name reaches any stored field', () => {
  const names = ['Sarah', 'Michael', 'Zoë', 'أحمد'];
  const cards = [UBER_STANDARD, UBER_OCR_NOISE, EU_UBER, EG_UBER_ARABIC];
  for (const [i, text] of cards.entries()) {
    const ev = evaluateInput(card(text), DEFAULT_SETTINGS, DEFAULT_ZONES);
    const rec = toRecord(ev, 1_700_000_000_000, 1);
    assert.ok(rec.riderRating != null || i === 1, `rating missing on card ${i}`);
    const full: OfferRecord = { ...rec, id: 1, synced: false };
    const everywhere = [
      JSON.stringify(rec),
      offersToCsv([full]),
      toJsonExport([full], [], { driverId: '', exportedAt: 0 }),
      JSON.stringify(buildBatch([full], [], { driverId: '', appVersion: '1.1.0', now: 0 })),
    ].join('\n');
    assert.ok(!everywhere.includes(names[i]), `${names[i]} leaked`);
    assert.ok(!Object.keys(rec).some((k) => /name/i.test(k)), 'no name-like field on a record');
  }
  const rec = toRecord(evaluateInput(card(UBER_STANDARD), DEFAULT_SETTINGS, DEFAULT_ZONES), 0, null);
  assert.equal(rec.riderRating, 4.93);
  assert.equal(rec.totalMi, 15.4);
  assert.equal(rec.totalMin, 27);
  assert.equal(rec.currency, 'USD');
  assert.equal(rec.distanceUnit, 'mi');
  assert.equal(rec.market, 'US');
});

test('exports carry the new columns', () => {
  const rec = toRecord(evaluateInput(card(EU_UBER), DEFAULT_SETTINGS, DEFAULT_ZONES), 0, null);
  const csv = offersToCsv([{ ...rec, id: 1, synced: false }]);
  const header = csv.split('\r\n')[0];
  for (const col of ['totalMi', 'totalMin', 'riderRating', 'currency', 'distanceUnit', 'market']) {
    assert.ok(header.split(',').includes(col), col);
  }
  assert.match(csv, /,EUR,km,EU\r\n$/);
});

// --- Overlay on the offer card ----------------------------------------------------------------

test('overlay floats on the detected card: anchor passed through in "card" mode', () => {
  const ev = evaluateInput(card(UBER_STANDARD), DEFAULT_SETTINGS, DEFAULT_ZONES);
  const o = buildOverlay(ev.grade, ev.parsed, DEFAULT_SETTINGS.overlay, ev.fmt, { top: 0.52, bottom: 0.96 });
  assert.equal(o.position, 'card');
  assert.equal(o.anchorTop, 0.52);
  assert.equal(o.anchorBottom, 0.96);
  assert.equal(o.rating, '★ 4.93');
  assert.equal(o.meta, '$18.42 · 15.4 mi · 27 min total');
  assert.equal(o.mileLabel, MILE_LABEL);
  // Unknown or nonsense position → native falls back to the top of the screen.
  const none = buildOverlay(ev.grade, ev.parsed, DEFAULT_SETTINGS.overlay, ev.fmt, null);
  assert.equal(none.anchorTop, -1);
  assert.equal(cleanAnchor({ top: 0.9, bottom: 0.91 }), null);
  assert.equal(cleanAnchor({ top: 'x', bottom: 1 }), null);
  // Fixed positions ignore the anchor.
  const top = buildOverlay(ev.grade, ev.parsed, { seconds: 7, position: 'top' }, ev.fmt, { top: 0.5, bottom: 0.9 });
  assert.equal(top.anchorTop, -1);
});

test('overlay in a km market: per-km label, local currency, decimal comma', () => {
  const ev = evaluateInput(card(EU_UBER), DEFAULT_SETTINGS, DEFAULT_ZONES);
  const o = buildOverlay(ev.grade, ev.parsed, DEFAULT_SETTINGS.overlay, ev.fmt);
  assert.equal(o.mileLabel, KM_LABEL);
  assert.match(o.mile, /€\d+,\d{2}\/km|^−?€/);
  assert.match(o.hour, /^−?€\d+\/hr$/);
  assert.equal(o.rating, '★ 4,91');
  assert.match(o.meta, /^€12,50 · 11,0 km · 22 min total$/);
});

// --- Settings migration ---------------------------------------------------------------------

test('settings from vc10 migrate: custom costs become the US profile; overlay moves onto the card', () => {
  const old = { grading: { ...DEFAULT_GRADING, costPerMile: 0.42, greatMinNetPerHour: 32 }, overlay: { seconds: 9, position: 'top' } };
  const s = normalizeSettings(old);
  assert.equal(s.settingsVersion, 2);
  assert.equal(s.market.home, 'US');
  assert.equal(s.market.profiles.US?.costPerUnit, 0.42);
  assert.equal(s.market.profiles.US?.greatMinNetPerHour, 32);
  assert.equal(s.grading.costPerMile, 0.42);
  assert.equal(s.overlay.position, 'card');
  assert.equal(s.overlay.seconds, 9);
  // "Middle" was an explicit choice and is kept.
  assert.equal(normalizeSettings({ overlay: { position: 'center' } }).overlay.position, 'center');
  // After v11, "Top of screen" is an explicit choice too.
  assert.equal(normalizeSettings({ settingsVersion: 2, overlay: { position: 'top' } }).overlay.position, 'top');
  // Untouched vc10 settings store no profile at all (defaults keep following the app).
  assert.deepEqual(normalizeSettings({ grading: DEFAULT_GRADING }).market.profiles, {});
});

test('market profiles are clamped and kept coherent (BAD never above GREAT)', () => {
  const s = normalizeSettings({
    settingsVersion: 2,
    market: { home: 'XX', autoDetect: 'yes', profiles: { EG: { greatMinNetPerUnit: 30, badBelowNetPerUnit: 50, costPerUnit: 'abc' }, ZZ: {} } },
  });
  assert.equal(s.market.home, 'US');
  assert.equal(s.market.autoDetect, true);
  assert.ok(!('ZZ' in s.market.profiles));
  const eg = s.market.profiles.EG!;
  assert.equal(eg.badBelowNetPerUnit, 30);
  assert.ok(eg.costPerUnit > 0);
  assert.equal(formatFor('EG').unit, 'km');
  assert.ok(Math.abs(KM_PER_MI - 1.609344) < 1e-12);
});
