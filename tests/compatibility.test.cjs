'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compatibilityFor } = require('../electron/lib/compatibility.cjs');

test('known anti-cheat titles are blocked', () => {
  const result = compatibilityFor('1085660');
  assert.equal(result.level, 'blocked');
  assert.match(result.reason, /BattlEye/);
});

test('known uncertain titles show caution', () => {
  assert.equal(compatibilityFor(730).level, 'caution');
});

test('unknown titles never claim compatibility', () => {
  const result = compatibilityFor('10');
  assert.equal(result.level, 'untested');
  assert.match(result.reason, /取决于/);
});
