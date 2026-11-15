import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBatch, classifyStatus, MAX_BATCH } from '../src/sync/payload';
import { csvCell, offersToCsv } from '../src/export/format';
import type { OfferRecord, WaitRow } from '../src/engine/records';
import { normalizeSettings } from '../src/config/validate';

const offer = (id: number, ts: number, synced = false): OfferRecord => ({
  id, sessionId: 1, ts, platform: 'uber', fare: 10, surge: null, surgeIncluded: false, total: 10,
  pickupMi: 1, pickupMin: 3, tripMi: 5, tripMin: 12, pickupArea: 'A', dropoffArea: 'B', riderRating: 4.9,
  offerType: 'UberX', multiStop: false, zoneClass: 'neutral', zoneKeyword: null, effMi: 6, effMin: 15,
  cost: 1.8, net: 8.2, grossPerMile: 1.67, grossPerHour: 40, netPerMile: 1.37, netPerHour: 32.8,
  verdict: 'GREAT', reason: 'r', flags: [], confidence: 1, readPath: 'primary', fallbackFields: [],
  rawText: '=HYPERLINK("x")', synced,
});
const wait = (id: number, startTs: number): WaitRow => ({
  id, sessionId: 1, zoneText: null, startTs, durationSec: 60, endedBy: 'offer', startedBy: 'online', synced: false,
});

test('batch: unsynced only, oldest first, max 200 combined', () => {
  const offers = Array.from({ length: 150 }, (_, i) => offer(i + 1, 1000 + i * 2));
  const waits = Array.from({ length: 150 }, (_, i) => wait(i + 1, 1001 + i * 2));
  offers[0].synced = true;
  const b = buildBatch(offers, waits, { driverId: 'd1', appVersion: '1.0.0', now: 0 })!;
  assert.equal(b.offerIds.length + b.waitIds.length, MAX_BATCH);
  assert.ok(!b.offerIds.includes(1));
  assert.equal(b.payload.waits[0].id, 1);
  assert.equal(buildBatch([], [], { driverId: '', appVersion: '', now: 0 }), null);
});

test('status handling', () => {
  assert.equal(classifyStatus(200), 'synced');
  assert.equal(classifyStatus(401), 'key_rejected');
  assert.equal(classifyStatus(500), 'failed');
  assert.equal(classifyStatus(201), 'failed');
});

test('CSV escapes and neutralizes formulas', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.ok(offersToCsv([offer(1, 0)]).includes(`"'=HYPERLINK(""x"")"`));
});

test('settings: defaults, clamping, sync off by default', () => {
  const s = normalizeSettings({ grading: { costPerMile: 'abc', badBelowNetPerMile: 99 } });
  assert.equal(s.sync.enabled, false);
  assert.equal(s.grading.costPerMile, 0.3);
  assert.ok(s.grading.badBelowNetPerMile <= s.grading.greatMinNetPerMile);
});
