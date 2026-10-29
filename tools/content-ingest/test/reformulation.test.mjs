import assert from 'node:assert/strict';
import test from 'node:test';

import { compareForReformulation, longestSharedRun, tokenise } from '../src/reformulation.mjs';

const source =
  'The organization shall define, approve, publish and communicate an information security policy at the top level, and review it at planned intervals.';

test('text copiat este respins', () => {
  const result = compareForReformulation(source, source);
  assert.equal(result.ok, false);
  assert.match(result.reason, /secvență|refolosește/);
  assert.ok(result.longestRun >= 10);
});

test('parafraza în altă limbă este acceptată', () => {
  const result = compareForReformulation(
    'Conducerea aprobă și publică o politică de securitate a informației la nivelul organizației, revizuită periodic.',
    source,
  );
  assert.equal(result.ok, true);
  assert.ok(result.overlap < 0.6);
});

test('o expresie tehnică scurtă comună nu blochează promovarea', () => {
  const result = compareForReformulation(
    'Politica de securitate a informației este aprobată de conducere și comunicată tuturor angajaților.',
    source,
  );
  assert.equal(result.ok, true);
  assert.ok(result.longestRun < 10);
});

test('rulează pe tokeni normalizați, fără diacritice și punctuație', () => {
  assert.deepEqual(tokenise('Politică, risc și control!'), ['politica', 'risc', 'si', 'control']);
  assert.equal(
    longestSharedRun(tokenise('un doi trei patru'), tokenise('zero un doi trei cinci')),
    3,
  );
});
