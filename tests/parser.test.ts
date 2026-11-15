import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCard, metricPairs, normalizeLine } from '../src/ocr/parser';
import { card, UBER_STANDARD, LYFT_BONUS, UBER_OCR_NOISE, UBER_DEAD_ZONE } from './fixtures';

test('normalizes common OCR confusions', () => {
  assert.equal(normalizeLine('S24.75'), '$24.75');
  assert.equal(normalizeLine('$ 12,50'), '$12.50');
  assert.equal(normalizeLine('6 rnins (2.2 mi)'), '6 mins (2.2 mi)');
});

test('metric pairs in both orders, hours supported', () => {
  assert.deepEqual(metricPairs('5 mins (1.8 mi) away'), [{ min: 5, mi: 1.8 }]);
  assert.deepEqual(metricPairs('3.1 mi · 8 min'), [{ min: 8, mi: 3.1 }]);
  assert.deepEqual(metricPairs('1 hr 5 min (38.4 mi) trip'), [{ min: 65, mi: 38.4 }]);
});

test('Uber standard card: all fields via primary region read', () => {
  const p = parseCard(card(UBER_STANDARD));
  assert.equal(p.platform, 'uber');
  assert.equal(p.offerType, 'UberX');
  assert.equal(p.fare, 18.42);
  assert.equal(p.riderRating, 4.93);
  assert.equal(p.pickupMin, 5);
  assert.equal(p.pickupMi, 1.8);
  assert.equal(p.tripMin, 22);
  assert.equal(p.tripMi, 13.6);
  assert.equal(p.pickupArea, 'Fair Lakes Pkwy & Monument Dr, Fairfax');
  assert.equal(p.dropoffArea, 'Wilson Blvd & N Lynn St, Arlington');
  assert.equal(p.readPath, 'primary');
  assert.deepEqual(p.fallbackFields, []);
  assert.equal(p.multiStop, false);
  assert.ok(p.confidence >= 0.95, `confidence ${p.confidence}`);
});

test('rider name never survives into stored text', () => {
  const p = parseCard(card(UBER_STANDARD));
  assert.ok(!/sarah/i.test(p.rawText), p.rawText);
  assert.ok(p.rawText.includes('[rider]'));
  const n = parseCard(card(UBER_OCR_NOISE));
  assert.ok(!/michael/i.test(n.rawText), n.rawText);
  assert.ok(!/michael/i.test(n.pickupArea ?? ''));
});

test('Lyft card with separate bonus', () => {
  const p = parseCard(card(LYFT_BONUS));
  assert.equal(p.platform, 'lyft');
  assert.equal(p.fare, 14.2);
  assert.equal(p.surge, 3);
  assert.equal(p.surgeIncluded, false);
  assert.equal(p.pickupMin, 8);
  assert.equal(p.tripMi, 9.4);
  assert.equal(p.riderRating, 4.88);
  assert.equal(p.dropoffArea, 'Dropoff near Bethesda Row, Bethesda');
});

test('noisy OCR: fixes S->$, rnin->min, hours, multi-stop', () => {
  const p = parseCard(card(UBER_OCR_NOISE));
  assert.equal(p.fare, 24.75);
  assert.equal(p.offerType, 'Comfort');
  assert.equal(p.pickupMin, 6);
  assert.equal(p.tripMin, 65);
  assert.equal(p.tripMi, 38.4);
  assert.equal(p.multiStop, true);
  assert.equal(p.stopCount, 2);
  assert.equal(p.dropoffArea, 'Dulles Town Center, Sterling');
});

test('fallback path: region read fails, full-card pattern scan recovers', () => {
  // Compressed card: everything sits in the top band so the pickup/trip regions are empty.
  const lines = [
    { text: 'UberX', y: 0.0 },
    { text: '$22.10', y: 0.04 },
    { text: '9 mins (3.4 mi) away', y: 0.08 },
    { text: 'Reston Town Center, Reston', y: 0.12 },
    { text: '25 mins (14.0 mi) trip', y: 0.16 },
    { text: 'Clarendon Blvd, Arlington', y: 0.2 },
  ].map((l) => ({ ...l, x: 0.05, w: 0.9, h: 0.03 }));
  const p = parseCard({ text: lines.map((l) => l.text).join('\n'), lines });
  assert.equal(p.readPath, 'fallback');
  assert.ok(p.fallbackFields.includes('pickupMi'));
  assert.ok(p.fallbackFields.includes('tripMin'));
  assert.equal(p.pickupMin, 9);
  assert.equal(p.tripMi, 14);
  assert.equal(p.dropoffArea, 'Clarendon Blvd, Arlington');
  assert.equal(p.fare, 22.1);
});

test('implausible primary read is rejected and replaced by fallback', () => {
  // OCR misread "13.6 mi" as "136 mi" in a 22 min trip -> 370 mph, implausible.
  const text = UBER_STANDARD.replace('22 mins (13.6 mi) trip', '22 mins (136 mi) trip');
  const p = parseCard(card(text));
  assert.equal(p.tripMi, null);
  assert.equal(p.tripMin, null);
});

test('dead-zone fixture parses dropoff', () => {
  const p = parseCard(card(UBER_DEAD_ZONE));
  assert.equal(p.dropoffArea, 'Main St, Warrenton, VA');
  assert.equal(p.tripMi, 41.2);
});
