import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeLines, sanitizeText } from '../src/privacy/sanitize';

test('strips name next to rating on the same line', () => {
  const r = sanitizeLines(['Sarah ★ 4.95', 'Picked from Sarah list']);
  assert.equal(r.lines[0], '[rider] ★ 4.95');
  assert.ok(!r.lines.join(' ').includes('Sarah'));
});

test('strips lone name line adjacent to rating', () => {
  const r = sanitizeLines(['UberX', '$12.00', 'Jordan M.', '4.88 ★']);
  assert.equal(r.lines[2], '[rider]');
  assert.equal(r.lines[0], 'UberX');
});

test('strips context phrases and possessives', () => {
  assert.equal(sanitizeText('Picking up Michael'), 'Picking up [rider]');
  assert.equal(sanitizeText("Aisha's trip"), "[rider]'s trip");
  assert.equal(sanitizeText('Rider: Chen'), 'Rider: [rider]');
});

test('keeps places, card vocabulary and addresses', () => {
  const lines = ['UberX', 'Exclusive', '5 mins (1.8 mi) away', 'Fair Oaks', 'Main St, Warrenton, VA'];
  assert.deepEqual(sanitizeLines(lines).lines, lines);
  assert.equal(sanitizeText('Pick up at Tysons Corner Center'), 'Pick up at Tysons Corner Center');
});

test('zone keywords are protected', () => {
  const r = sanitizeLines(['Bethesda', '4.9 ★'], { safeWords: ['Bethesda'] });
  assert.equal(r.lines[0], 'Bethesda');
});
