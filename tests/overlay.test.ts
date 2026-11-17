import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOverlay, HOUR_LABEL, MILE_LABEL } from '../src/engine/overlay';
import { formatPerHour, formatPerMile, gradeOffer } from '../src/engine/grading';
import { parseCard } from '../src/ocr/parser';
import { DEFAULT_GRADING, DEFAULT_SETTINGS, DEFAULT_ZONES } from '../src/config/defaults';
import { card, UBER_STANDARD } from './fixtures';

test('headline formats: "$36/hr" and "68¢/mi" (dollars from $1/mi up)', () => {
  assert.equal(formatPerHour(36.2), '$36/hr');
  assert.equal(formatPerMile(0.68), '68¢/mi');
  assert.equal(formatPerMile(0.999), '$1.00/mi');
  assert.equal(formatPerMile(1.42), '$1.42/mi');
  assert.equal(formatPerMile(-0.12), '−12¢/mi');
  assert.equal(formatPerHour(-4.4), '−$4/hr');
  assert.equal(formatPerMile(null), '—');
});

test('overlay leads with net $/hr and net ¢/mi; verdict and reason support them', () => {
  const p = parseCard(card(UBER_STANDARD));
  const g = gradeOffer(p, DEFAULT_GRADING, DEFAULT_ZONES);
  const o = buildOverlay(g, p, DEFAULT_SETTINGS.overlay);
  assert.equal(o.hourLabel, HOUR_LABEL);
  assert.equal(o.mileLabel, MILE_LABEL);
  assert.equal(o.hour, '$31/hr');
  assert.equal(o.mile, '90¢/mi');
  assert.equal(o.verdict, 'OK');
  assert.equal(o.reason, 'Fair ride: per-mile below Great');
  assert.equal(o.durationMs, 7000);
});

test('unreadable card: CHECK with dashes, never a fake number', () => {
  const p = parseCard(card('Accept'));
  const g = gradeOffer(p, DEFAULT_GRADING, DEFAULT_ZONES);
  const o = buildOverlay(g, p, DEFAULT_SETTINGS.overlay);
  assert.equal(o.verdict, 'CHECK');
  assert.equal(o.hour, '—');
  assert.equal(o.mile, '—');
});
