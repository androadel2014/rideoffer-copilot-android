import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WaitTracker } from '../src/engine/waitTracker';
import type { WaitRecord } from '../src/engine/types';

const s = (n: number) => n * 1000;

test('online -> offer -> trip -> dropoff -> offer', () => {
  const out: WaitRecord[] = [];
  const w = new WaitTracker((r) => out.push(r));
  w.start(s(0));
  w.offer(s(300), 'Wilson Blvd, Arlington');
  assert.deepEqual(out[0], { zoneText: null, startTs: 0, durationSec: 300, endedBy: 'offer', startedBy: 'online' });
  w.screen('trip', s(310));
  w.screen('idle', s(2000));
  w.offer(s(2240), 'Somewhere');
  assert.equal(out[1].zoneText, 'Wilson Blvd, Arlington');
  assert.equal(out[1].durationSec, 240);
  assert.equal(out[1].startedBy, 'dropoff');
});

test('declined offer resumes waiting in the same place; stop closes', () => {
  const out: WaitRecord[] = [];
  const w = new WaitTracker((r) => out.push(r));
  w.start(s(0));
  w.offer(s(60), 'X');
  w.screen('idle', s(75));
  w.stop(s(200));
  assert.equal(out.length, 2);
  assert.equal(out[1].startedBy, 'declined');
  assert.equal(out[1].endedBy, 'stopped');
  assert.equal(out[1].durationSec, 125);
});

test('stacked offer during a trip does not end the trip', () => {
  const out: WaitRecord[] = [];
  const w = new WaitTracker((r) => out.push(r));
  w.start(s(0));
  w.offer(s(10), 'A');
  w.screen('trip', s(20));
  w.offer(s(500), 'B');
  assert.equal(w.state, 'trip');
  w.screen('idle', s(900));
  assert.equal(w.openWait?.startedBy, 'dropoff');
});

test('ignores signals while stopped', () => {
  const out: WaitRecord[] = [];
  const w = new WaitTracker((r) => out.push(r));
  w.offer(s(1), 'A');
  w.screen('idle', s(2));
  w.stop(s(3));
  assert.equal(out.length, 0);
});
