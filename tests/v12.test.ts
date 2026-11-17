import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeOffer } from '../src/engine/grading';
import { buildOverlay } from '../src/engine/overlay';
import { evaluateInput } from '../src/engine/evaluate';
import { parseCard } from '../src/ocr/parser';
import { DEFAULT_GRADING, DEFAULT_SETTINGS, DEFAULT_ZONES } from '../src/config/defaults';
import {
  card,
  LYFT_BONUS,
  UBER_STANDARD,
  VC12_LYFT_UNLABELLED_TOTAL,
  VC12_TOTAL_LABEL_SPLIT,
  VC12_TOTAL_LINE_CARD,
  VC12_TOTAL_LINE_NO_PICKUP,
} from './fixtures';

// --- vc12 defect 2: the TOTAL line is the full trip; never add a second trip on top --------

test('vc12 regression: field-test card grades on its total 22 min / 7.8 mi → net $5.79, $15.79/hr, $0.74/mi, BAD', () => {
  // The defaults this verdict depends on.
  assert.equal(DEFAULT_GRADING.costPerMile, 0.3);
  assert.equal(DEFAULT_GRADING.badBelowNetPerHour, 18);
  assert.equal(DEFAULT_GRADING.badBelowNetPerMile, 0.8);

  const p = parseCard(card(VC12_TOTAL_LINE_CARD));
  assert.equal(p.fare, 8.13);
  assert.equal(p.totalMin, 22);
  assert.equal(p.totalMi, 7.8);
  assert.equal(p.pickupMin, 5);
  assert.equal(p.pickupMi, 1.1);
  assert.equal(p.tripMin, 17);
  assert.equal(p.tripMi, 6.7);

  const g = gradeOffer(p, DEFAULT_GRADING, DEFAULT_ZONES);
  assert.equal(g.gradable, true);
  assert.equal(g.totalMin, 22);
  assert.equal(g.totalMi, 7.8);
  assert.notEqual(g.totalMin, 39, 'trip added on top of the total');
  assert.notEqual(g.totalMi, 14.5, 'trip added on top of the total');
  assert.equal(g.cost, 2.34);
  assert.equal(g.net, 5.79);
  // $15.79/hr: net over the card's 22 minutes (the engine stores per-hour to 0.1).
  assert.equal(((g.net as number) / ((g.effMin as number) / 60)).toFixed(2), '15.79');
  assert.equal(g.netPerHour, 15.8);
  assert.equal(g.netPerMile, 0.74);
  assert.equal(g.verdict, 'BAD');
  assert.match(g.reason, /under your \$18\/hr floor/);

  // The overlay shows the card's total and the rider rating.
  const o = buildOverlay(g, p, DEFAULT_SETTINGS.overlay);
  assert.equal(o.verdict, 'BAD');
  assert.equal(o.meta, '$8.13 · 7.8 mi · 22 min total');
  assert.equal(o.mile, '74¢/mi');
  assert.equal(o.rating, '★ 4.94');
});

test('vc12 regression: the same card graded through the live pipeline (evaluateInput)', () => {
  const ev = evaluateInput(card(VC12_TOTAL_LINE_CARD), DEFAULT_SETTINGS, DEFAULT_ZONES);
  assert.equal(ev.grade.totalMin, 22);
  assert.equal(ev.grade.totalMi, 7.8);
  assert.equal(ev.grade.net, 5.79);
  assert.equal(ev.grade.netPerMile, 0.74);
  assert.equal(ev.grade.verdict, 'BAD');
  assert.equal(ev.parsed.riderRating, 4.94);
});

test('vc12 regression: OCR variants of the card (no pickup line, split "Total" label, Lyft unlabelled) grade the same', () => {
  for (const text of [VC12_TOTAL_LINE_NO_PICKUP, VC12_TOTAL_LABEL_SPLIT, VC12_LYFT_UNLABELLED_TOTAL]) {
    const p = parseCard(card(text));
    assert.equal(p.totalMin, 22, text);
    assert.equal(p.totalMi, 7.8, text);
    assert.equal(p.tripMin, 17, text);
    assert.equal(p.tripMi, 6.7, text);
    const g = gradeOffer(p, DEFAULT_GRADING, DEFAULT_ZONES);
    assert.equal(g.totalMin, 22, text);
    assert.equal(g.totalMi, 7.8, text);
    assert.equal(g.net, 5.79, text);
    assert.equal(g.netPerMile, 0.74, text);
    assert.equal(g.verdict, 'BAD', text);
  }
});

test('vc12: cards without a total line still add pickup + trip', () => {
  const lyft = parseCard(card(LYFT_BONUS)); // two unlabelled lines = pickup, trip
  assert.equal(lyft.totalMi, null);
  assert.equal(gradeOffer(lyft, DEFAULT_GRADING, DEFAULT_ZONES).totalMi, 12.5);
  const uber = parseCard(card(UBER_STANDARD));
  assert.equal(uber.totalMi, null);
  assert.equal(gradeOffer(uber, DEFAULT_GRADING, DEFAULT_ZONES).totalMi, 15.4);
});

// --- vc12 defect 3: rider rating on the overlay --------------------------------------------

test('vc12: the overlay payload carries the rider rating (and none when the card has none)', () => {
  const ev = evaluateInput(card(VC12_TOTAL_LINE_CARD), DEFAULT_SETTINGS, DEFAULT_ZONES);
  assert.equal(buildOverlay(ev.grade, ev.parsed, DEFAULT_SETTINGS.overlay, ev.fmt).rating, '★ 4.94');
  const noRating = evaluateInput(card(VC12_TOTAL_LINE_CARD.replace('★ 4.94\n', '')), DEFAULT_SETTINGS, DEFAULT_ZONES);
  assert.equal(buildOverlay(noRating.grade, noRating.parsed, DEFAULT_SETTINGS.overlay, noRating.fmt).rating, '');
});

// --- vc12 defects 1 and 3 live in Kotlin; guard that the fixes stay wired up -----------------

import { readFileSync } from 'node:fs';
import path from 'node:path';

const NATIVE = path.resolve(__dirname, '../../modules/screen-watcher/android/src/main/java/com/rideoffercopilot/screenwatcher');
const kt = (f: string) => readFileSync(path.join(NATIVE, f), 'utf8');

test('vc12 native: verdict is bound to its on-screen card and removed when the card goes', () => {
  const fp = kt('FrameProcessor.kt');
  assert.match(fp, /"cardSeq" to seq/, 'onCard event carries the card sequence number');
  assert.match(fp, /cardLooksGone\(frame\)\) endCard\(\)/, 'pixel gone-check runs on every frame before OCR');
  assert.match(fp, /OverlayController\.hideForCard\(seq\)/, 'card gone removes its verdict');
  const ov = kt('OverlayController.kt');
  assert.match(ov, /!CardPresence\.isActive\(seq\)\) return false/, 'a verdict for a closed card is never drawn');
  assert.match(kt('ScreenWatchService.kt'), /FAST_FRAME_INTERVAL_MS = 150L/);
  const wc = readFileSync(path.resolve(__dirname, '../../src/state/watchController.ts'), 'utf8');
  assert.match(wc, /showVerdictOverlay\(ev, anchor, cardSeq\)/, 'JS sends the cardSeq back with the verdict');
});

test('vc12 native: the overlay draws the rider rating from the payload', () => {
  assert.match(kt('OverlayController.kt'), /p\["rating"\]/);
});
