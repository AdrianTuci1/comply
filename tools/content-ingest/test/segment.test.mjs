import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { extractDocument } from '../src/extract.mjs';
import { frameworkConfig } from '../src/frameworks.mjs';
import { segment } from '../src/segment.mjs';
import { FIXTURES } from './helpers.mjs';

async function segmentsFor(file, frameworkId, document) {
  const { entries } = await extractDocument(join(FIXTURES, file));
  return segment(entries, frameworkConfig(frameworkId), { document });
}

test('NIS2: articolele devin cerințe, literele devin cerințe separate', async () => {
  const { candidates } = await segmentsFor('nis2-sample.txt', 'nis2', 'Directiva (UE) 2022/2555');

  assert.deepEqual(
    candidates.map((candidate) => candidate.ref),
    [
      'Art. 20',
      'Art. 21(2)(a)',
      'Art. 21(2)(b)',
      'Art. 21(2)(c)',
      'Art. 21(2)(d)',
      'Art. 21(2)(e)',
    ],
  );
  const first = candidates.find((candidate) => candidate.ref === 'Art. 21(2)(a)');
  assert.match(first.text, /politici de analiză a riscurilor/);
  assert.equal(first.theme, 'Guvernanță și risc');
  assert.match(first.sourceRef, /^Directiva \(UE\) 2022\/2555, l\. 12$/);
  assert.ok(first.warnings.some((warning) => warning.includes('Rescrie cerința')));
});

test('ISO 27001: clauzele și controalele Anexei A sunt recunoscute', async () => {
  const { candidates, warnings } = await segmentsFor(
    'iso-sample.txt',
    'iso27001',
    'ISO/IEC 27001:2022',
  );

  assert.deepEqual(
    candidates.map((candidate) => candidate.ref),
    ['4.1', 'A.5.1', 'A.8.24'],
  );
  assert.equal(candidates[1].theme, 'Controale organizaționale');
  assert.equal(candidates[2].theme, 'Controale tehnologice');
  assert.ok(warnings.some((warning) => warning.includes('4 ')));
  assert.ok(
    candidates.every((candidate) =>
      candidate.warnings.some((warning) => warning.includes('Sursă licențiată')),
    ),
  );
});

test('EU AI Act: paragrafele și literele compun referința', async () => {
  const { candidates } = await segmentsFor('ai-act-sample.txt', 'ai-act', 'Regulamentul (UE) 2024/1689');

  assert.deepEqual(
    candidates.map((candidate) => candidate.ref),
    ['Art. 9(2)(a)', 'Art. 9(2)(b)', 'Art. 9(2)(c)', 'Art. 10'],
  );
  assert.match(candidates[0].sourceRef, /^Regulamentul \(UE\) 2024\/1689, l\. 7$/);
});

test('un document fără titluri nu produce candidați și explică de ce', () => {
  const result = segment(
    [{ text: 'Text fără nicio structură recunoscută.', line: 1, page: null }],
    frameworkConfig('nis2'),
    { document: 'Test' },
  );

  assert.equal(result.candidates.length, 0);
  assert.match(result.warnings[0], /Nu am găsit titluri/);
});

test('un titlu prea scurt este ignorat, nu transformat în cerință', async () => {
  const { entries } = await extractDocument(join(FIXTURES, 'iso-sample.txt'));
  const result = segment(entries, frameworkConfig('iso27001'), { document: 'ISO' });
  assert.ok(result.candidates.every((candidate) => candidate.text.length >= 20));
});
