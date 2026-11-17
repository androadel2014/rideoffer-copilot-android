import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeOffer } from '../src/engine/grading';
import { parseCard } from '../src/ocr/parser';
import { DEFAULT_GRADING, DEFAULT_ZONES } from '../src/config/defaults';
import { matchZone } from '../src/engine/zones';
import { card, UBER_STANDARD, UBER_DEAD_ZONE, LYFT_BONUS } from './fixtures';

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

test('math: effective totals include the pickup leg; net after per-mile cost', () => {
  const g = gradeOffer(base, DEFAULT_GRADING, DEFAULT_ZONES);
  assert.equal(g.effMi, 12);
  assert.equal(g.effMin, 26);
  assert.equal(g.cost, 3.6);
  assert.equal(g.net, 16.4);
  assert.equal(g.grossPerMile, 1.67);
  assert.equal(g.netPerMile, 1.37);
  assert.equal(g.netPerHour, 37.8);
  assert.equal(g.verdict, 'GREAT');
});

test('tiers: OK and BAD', () => {
  assert.equal(gradeOffer({ ...base, fare: 15 }, DEFAULT_GRADING, DEFAULT_ZONES).verdict, 'OK');
  const bad = gradeOffer({ ...base, fare: 10 }, DEFAULT_GRADING, DEFAULT_ZONES);
  assert.equal(bad.verdict, 'BAD');
  // $10 fare: net $14.8/hr is under the $18/hr floor (hour is named first; it leads the overlay).
  assert.match(bad.reason, /^Net \$15\/hr is under your \$18\/hr floor$/);
  // Per-mile floor phrased in cents.
  const slowMi = gradeOffer({ ...base, fare: 11, tripMin: 8, pickupMin: 2 }, DEFAULT_GRADING, DEFAULT_ZONES);
  assert.match(slowMi.reason, /^Net 62¢\/mi is under your 80¢\/mi floor$/);
});

test('dead-zone dropoff adds reposition penalty and names the reason', () => {
  const without = gradeOffer({ ...base, fare: 20, dropoffArea: 'Fairfax' }, DEFAULT_GRADING, DEFAULT_ZONES);
  const dead = gradeOffer({ ...base, fare: 20, dropoffArea: 'Main St, Warrenton, VA' }, DEFAULT_GRADING, DEFAULT_ZONES);
  assert.equal(dead.penaltyApplied, true);
  assert.equal(dead.effMi, 20);
  assert.equal(dead.effMin, 51);
  assert.ok((dead.netPerHour ?? 0) < (without.netPerHour ?? 0));
  assert.match(dead.reason, /^Dead-zone dropoff: Warrenton/);
  assert.notEqual(dead.verdict, 'GREAT');
});

test('real fixtures end-to-end', () => {
  const s = gradeOffer(parseCard(card(UBER_STANDARD)), DEFAULT_GRADING, DEFAULT_ZONES);
  assert.equal(s.verdict, 'OK');
  assert.ok(s.flags.some((f) => f.startsWith('Hot-zone dropoff (Arlington)')));
  const d = gradeOffer(parseCard(card(UBER_DEAD_ZONE)), DEFAULT_GRADING, DEFAULT_ZONES);
  assert.equal(d.verdict, 'BAD');
  assert.match(d.reason, /Dead-zone dropoff/);
  assert.ok(d.flags.some((f) => f.startsWith('Long trip')));
  const l = gradeOffer(parseCard(card(LYFT_BONUS)), DEFAULT_GRADING, DEFAULT_ZONES);
  assert.equal(l.total, 17.2, 'separate bonus added');
});

test('flags: long pickup, multi-stop, low rating, shared', () => {
  const g = gradeOffer(
    { ...base, pickupMin: 15, multiStop: true, riderRating: 4.5, offerType: 'UberX Share' },
    DEFAULT_GRADING,
    DEFAULT_ZONES
  );
  assert.ok(g.flags.includes('Long pickup (15 min)'));
  assert.ok(g.flags.includes('Multi-stop'));
  assert.ok(g.flags.includes('Rider 4.50★'));
  assert.ok(g.flags.includes('Shared ride'));
});

test('ungradable without fare; estimates missing miles from minutes', () => {
  assert.equal(gradeOffer({ ...base, fare: null }, DEFAULT_GRADING, DEFAULT_ZONES).gradable, false);
  const e = gradeOffer({ ...base, tripMi: null }, DEFAULT_GRADING, DEFAULT_ZONES);
  assert.equal(e.gradable, true);
  assert.deepEqual(e.estimated, ['tripMi']);
});

test('zones: longest keyword wins, whole words only', () => {
  assert.equal(matchZone('Washington Dulles International Airport', DEFAULT_ZONES).zoneClass, 'neutral');
  assert.equal(matchZone('1st St NW, Washington, DC 20001', DEFAULT_ZONES).zoneClass, 'hot');
  assert.equal(matchZone('Arlington', DEFAULT_ZONES).zoneClass, 'hot');
  assert.equal(matchZone('Culpeper, VA', DEFAULT_ZONES).zoneClass, 'dead');
  assert.equal(matchZone('Marshallton Rd', DEFAULT_ZONES).zoneClass, 'neutral');
  assert.equal(matchZone(null, DEFAULT_ZONES).keyword, null);
});
