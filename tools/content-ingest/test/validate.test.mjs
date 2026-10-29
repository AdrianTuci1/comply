import assert from 'node:assert/strict';
import test from 'node:test';

import { validateAll } from '../src/validate.mjs';
import {
  CONTRACTS_ROOT,
  createBundle,
  makeQuestion,
  makeRequirement,
  tempDir,
} from './helpers.mjs';

const silent = () => {};

test('un bundle complet trece validarea', async (t) => {
  const contentRoot = await tempDir(t);
  await createBundle(contentRoot, {
    requirements: [makeRequirement()],
    questions: [makeQuestion()],
  });

  const result = await validateAll({ contentRoot, contractsRoot: CONTRACTS_ROOT, log: silent });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.results[0].counts.requirements, 1);
  assert.equal(result.results[0].counts.questions, 1);
});

test('o întrebare cu referință inexistentă este eroare', async (t) => {
  const contentRoot = await tempDir(t);
  await createBundle(contentRoot, {
    requirements: [makeRequirement()],
    questions: [makeQuestion({ requirementRef: 'Art. 99' })],
  });

  const result = await validateAll({ contentRoot, contractsRoot: CONTRACTS_ROOT, log: silent });
  assert.ok(result.errors.some((error) => error.includes('requirementRef „Art. 99” nu există')));
});

test('două cerințe cu același text sunt respinse', async (t) => {
  const contentRoot = await tempDir(t);
  await createBundle(contentRoot, {
    requirements: [
      makeRequirement({ id: 'nis2-a', ref: 'Art. 21(2)(a)' }),
      makeRequirement({ id: 'nis2-b', ref: 'Art. 21(2)(b)' }),
    ],
  });

  const result = await validateAll({ contentRoot, contractsRoot: CONTRACTS_ROOT, log: silent });
  assert.ok(result.errors.some((error) => error.includes('text identic')));
});

test('sursa licențiată cere review.reformulated=true', async (t) => {
  const contentRoot = await tempDir(t);
  await createBundle(contentRoot, {
    frameworkId: 'iso27001',
    version: '2022.1.0',
    license: 'proprietary',
    requirements: [
      makeRequirement({
        id: 'iso-a-5-1',
        frameworkId: 'iso27001',
        version: '2022.1.0',
        ref: 'A.5.1',
        title: 'Politici de securitate a informației',
        review: {
          reviewer: 'Ana Popescu',
          reviewedAt: '2026-10-29T10:00:00.000Z',
          reformulated: false,
        },
      }),
    ],
  });

  const result = await validateAll({ contentRoot, contractsRoot: CONTRACTS_ROOT, log: silent });
  assert.ok(result.errors.some((error) => error.includes('review.reformulated=true')));
});

test('schema respinge o cerință fără proveniență', async (t) => {
  const contentRoot = await tempDir(t);
  const requirement = makeRequirement();
  delete requirement.sourceRef;
  await createBundle(contentRoot, { requirements: [requirement] });

  const result = await validateAll({ contentRoot, contractsRoot: CONTRACTS_ROOT, log: silent });
  assert.ok(result.errors.some((error) => error.includes('sourceRef')));
});

test('raportează cerințele fără întrebare ca avertisment', async (t) => {
  const contentRoot = await tempDir(t);
  await createBundle(contentRoot, { requirements: [makeRequirement()] });

  const result = await validateAll({ contentRoot, contractsRoot: CONTRACTS_ROOT, log: silent });
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((warning) => warning.includes('nu au întrebare')));
});
