'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVdf, tokenize } = require('../electron/lib/vdf.cjs');

test('tokenize removes comments and unescapes quoted values', () => {
  assert.deepEqual(tokenize('// ignored\n"key" "C:\\\\Games\\\\Steam"'), ['key', 'C:\\Games\\Steam']);
});

test('parseVdf reads nested objects', () => {
  const result = parseVdf('"libraryfolders" { "0" { "path" "C:\\\\Steam" } }');
  assert.equal(result.libraryfolders['0'].path, 'C:\\Steam');
});

test('parseVdf rejects malformed input', () => {
  assert.throws(() => parseVdf('"root" { "key" "value"'), /Unclosed VDF object/);
});
