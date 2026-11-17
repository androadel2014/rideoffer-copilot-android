import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gradeOffer } from '../src/engine/grading';
import { buildOverlay } from '../src/engine/overlay';
import { evaluateInput } from '../src/engine/evaluate';
import { parseCard } from '../src/ocr/parser';
import { grossNetFields } from '../src/state/grossNet';
import { DEFAULT_GRADING, DEFAULT_SETTINGS, DEFAULT_ZONES } from '../src/config/defaults';
import { card, VC12_TOTAL_LINE_CARD, VC13_UBERX_EXCLUSIVE_REAL } from './fixtures';

// --- Regression fixtures that must grade BAD ------------------------------------------------

test('vc13 regression (b): real UberX Exclusive $19.06 card grades on its TOTAL 51 min / 31.9 mi → BAD', () => {
  const p = parseCard(card(VC13_UBERX_EXCLUSIVE_REAL));
  assert.equal(p.fare, 19.06);
  assert.equal(p.totalMin, 51);
  assert.equal(p.totalMi, 31.9);
  assert.equal(p.pickupMin, 10);
  assert.equal(p.pickupMi, 3.1);
  assert.equal(p.tripMin, 41);
  assert.equal(p.tripMi, 28.8);
  assert.equal(p.riderRating, 4.9);

  const g = gradeOffer(p, DEFAULT_GRADING, DEFAULT_ZONES);
  assert.equal(g.totalMin, 51, 'not the pickup or trip leg alone');
  assert.equal(g.totalMi, 31.9, 'not the pickup or trip leg alone');
  assert.equal(g.cost, 9.57);
  assert.equal(g.net, 9.49);
  assert.equal(((g.net as number) / ((g.effMin as number) / 60)).toFixed(2), '11.16');
  assert.equal(g.netPerMile, 0.3);
  assert.equal(g.verdict, 'BAD');

  const o = buildOverlay(g, p, DEFAULT_SETTINGS.overlay);
  assert.equal(o.rating, '★ 4.90');
  assert.equal(o.meta, '$19.06 · 31.9 mi · 51 min total');
});

test('vc13 regression (a): the vc12 total-line card still grades $5.79 net → BAD', () => {
  const ev = evaluateInput(card(VC12_TOTAL_LINE_CARD), DEFAULT_SETTINGS, DEFAULT_ZONES);
  assert.equal(ev.grade.totalMin, 22);
  assert.equal(ev.grade.totalMi, 7.8);
  assert.equal(ev.grade.net, 5.79);
  assert.equal(((ev.grade.net as number) / ((ev.grade.effMin as number) / 60)).toFixed(2), '15.79');
  assert.equal(ev.grade.netPerMile, 0.74);
  assert.equal(ev.grade.verdict, 'BAD');
});

// --- Gross and net side by side (display only) ----------------------------------------------

test('vc13: overlay shows GROSS and NET $/hr and $/mi, clearly labelled; verdict still from net', () => {
  const ev = evaluateInput(card(VC13_UBERX_EXCLUSIVE_REAL), DEFAULT_SETTINGS, DEFAULT_ZONES);
  const o = buildOverlay(ev.grade, ev.parsed, DEFAULT_SETTINGS.overlay, ev.fmt);
  const gn = grossNetFields(ev.grade, DEFAULT_SETTINGS.grading.costPerMile, ev.fmt);
  // Gross: $19.06 over 51 min / 31.9 mi.
  assert.equal(ev.grade.grossPerHour, 22.4);
  assert.equal(ev.grade.grossPerMile, 0.6);
  assert.equal(gn.grossHour, '$22/hr');
  assert.equal(gn.grossMile, '60¢/mi');
  assert.equal(gn.grossHourLabel, 'GROSS / HOUR');
  assert.equal(gn.grossMileLabel, 'GROSS / MILE');
  // Net (after $0.30/mi): the existing headline numbers.
  assert.equal(o.hourLabel, 'NET / HOUR');
  assert.equal(o.mileLabel, 'NET / MILE');
  assert.equal(o.hour, '$11/hr');
  assert.equal(o.mile, '30¢/mi');
  assert.equal(gn.netNote, 'Net = after $0.30/mi car cost');
  // The verdict is graded on net: gross clears both floors, net does not.
  assert.ok((ev.grade.grossPerHour as number) >= DEFAULT_GRADING.badBelowNetPerHour);
  assert.equal(ev.grade.verdict, 'BAD');
});

test('vc13: an unreadable card shows no gross figures', () => {
  const ev = evaluateInput(card('Some screen\nnothing to grade'), DEFAULT_SETTINGS, DEFAULT_ZONES);
  const gn = grossNetFields(ev.grade, 0.3, ev.fmt);
  assert.equal(gn.grossHour, '—');
  assert.equal(gn.grossMile, '—');
});

// --- vc13 native guards (Kotlin cannot run here; keep the fixes wired up) -------------------

const NATIVE = path.resolve(__dirname, '../../modules/screen-watcher/android/src/main/java/com/rideoffercopilot/screenwatcher');
const kt = (f: string) => readFileSync(path.join(NATIVE, f), 'utf8');

test('vc13 native: event-driven frames + pixel button locator + single card OCR', () => {
  const svc = kt('ScreenWatchService.kt');
  assert.match(svc, /setOnImageAvailableListener\(\{ onFrameAvailable\(s\) \}, s\.handler\)/);
  const fp = kt('FrameProcessor.kt');
  assert.match(fp, /CardLocator\.findAcceptButton\(frame, ex\)/);
  assert.match(fp, /val lines = readRegion\(frame, region\)/);
  assert.match(fp, /emitFromLines\(frame, card, lines\)/, 'fast path emits the single read, no second OCR');
  assert.match(kt('CardLocator.kt'), /fun cardRegion\(b: Bitmap, button: Rect\): Rect/);
});

test('vc13 native: verdict persists until dismissed; card leaving never clears it', () => {
  const fp = kt('FrameProcessor.kt');
  assert.doesNotMatch(fp, /hideForCard|OverlayController\.hide\(/, 'capture loop never hides the verdict');
  const ov = kt('OverlayController.kt');
  assert.doesNotMatch(ov, /fun hideForCard/);
  assert.match(ov, /if \(seq == 0L\) \{\s*\/\/ Previews/, 'only previews have the auto-hide timer');
  assert.match(ov, /dismissByDriver\(\) \/\/ tap on ✕, or a swipe/);
});

test('vc13 native: touches pass through the verdict; only the ✕ handle is touchable', () => {
  const ov = kt('OverlayController.kt');
  assert.match(ov, /FLAG_NOT_TOUCHABLE/);
  assert.match(ov, /alpha = passThroughOpacity\(ctx\)/, 'window opacity ≤ max obscuring opacity (Android 12+)');
  assert.match(ov, /maximumObscuringOpacityForTouch/);
  assert.match(ov, /val size = dp\(48\)/);
});

test('vc13 native: gross and net drawn side by side', () => {
  const ov = kt('OverlayController.kt');
  assert.match(ov, /p\["grossHour"\]/);
  assert.match(ov, /p\["grossMile"\]/);
  assert.match(ov, /p\["netNote"\]/);
});

test('vc13: versionCode 13', () => {
  const app = JSON.parse(readFileSync(path.resolve(__dirname, '../../app.json'), 'utf8'));
  assert.equal(app.expo.android.versionCode, 13);
  assert.match(readFileSync(path.resolve(__dirname, '../../plugins/withReleaseSigning.js'), 'utf8'), /\?: "13"/);
});
