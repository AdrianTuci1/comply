import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { promoteDraft } from '../src/promote.mjs';
import { makeDraft, readJson, tempDir, writeJson } from './helpers.mjs';

const NOW = new Date('2026-10-29T12:00:00.000Z');
const REVIEWER = 'Ana Popescu';

async function seedDraft(contentRoot, draft) {
  await writeJson(
    join(contentRoot, draft.frameworkId, draft.version, 'drafts', `${draft.id}.json`),
    draft,
  );
  return join(contentRoot, draft.frameworkId, draft.version, 'drafts', `${draft.id}.json`);
}

test('promovează un draft public în cerință și întrebare', async (t) => {
  const contentRoot = await tempDir(t);
  const draft = makeDraft({
    frameworkId: 'nis2',
    version: '2024.1.0',
    id: 'nis2-art-21-2-a',
    ref: 'Art. 21(2)(a)',
    title: 'Politici de analiză a riscurilor',
    text: 'Entitățile aprobă politici de analiză a riscurilor și de securitate a sistemelor informatice.',
    rawText:
      'Entitățile aprobă politici de analiză a riscurilor și de securitate a sistemelor informatice.',
    reviewedText:
      'Conducerea aprobă și revizuiește anual politicile de analiză a riscurilor și standardele de securitate pentru sistemele informatice.',
    theme: 'Guvernanță și risc',
  });
  const draftPath = await seedDraft(contentRoot, draft);

  const result = await promoteDraft({
    contentRoot,
    frameworkId: 'nis2',
    draftId: draft.id,
    reviewer: REVIEWER,
    now: NOW,
  });

  const requirement = await readJson(result.requirementPath);
  assert.equal(requirement.id, draft.id);
  assert.equal(requirement.ref, 'Art. 21(2)(a)');
  assert.equal(requirement.text, draft.reviewedText);
  assert.equal(requirement.review.reviewer, REVIEWER);
  assert.equal(requirement.review.reviewedAt, NOW.toISOString());
  assert.equal(requirement.review.reformulated, false);

  const question = await readJson(result.questionPath);
  assert.equal(question.requirementRef, requirement.ref);
  assert.equal(question.frameworkId, 'nis2');
  assert.equal(question.version, '2024.1.0');
  assert.ok(question.question.length >= 20);
  assert.ok(question.question.length <= 400);

  const updatedDraft = await readJson(draftPath);
  assert.equal(updatedDraft.review.status, 'promoted');
  assert.equal(updatedDraft.review.requirementId, draft.id);
});

test('cere reviewer și text revizuit', async (t) => {
  const contentRoot = await tempDir(t);
  const draft = makeDraft({ frameworkId: 'nis2', version: '2024.1.0', id: 'nis2-art-21-2-a' });
  await seedDraft(contentRoot, draft);

  await assert.rejects(
    () =>
      promoteDraft({
        contentRoot,
        frameworkId: 'nis2',
        draftId: draft.id,
        reviewer: '',
        now: NOW,
      }),
    /--reviewer/,
  );

  await assert.rejects(
    () =>
      promoteDraft({
        contentRoot,
        frameworkId: 'nis2',
        draftId: draft.id,
        reviewer: REVIEWER,
        now: NOW,
      }),
    /reviewedText/,
  );
});

test('respinge textul copiat dintr-o sursă licențiată', async (t) => {
  const contentRoot = await tempDir(t);
  const draft = makeDraft({ reviewedText: makeDraft().rawText });
  await seedDraft(contentRoot, draft);

  await assert.rejects(
    () =>
      promoteDraft({
        contentRoot,
        frameworkId: 'iso27001',
        draftId: draft.id,
        reviewer: REVIEWER,
        now: NOW,
      }),
    /--reformulated/,
  );

  await assert.rejects(
    () =>
      promoteDraft({
        contentRoot,
        frameworkId: 'iso27001',
        draftId: draft.id,
        reviewer: REVIEWER,
        overrides: { reformulated: true },
        now: NOW,
      }),
    /Verificare reformulare/,
  );
});

test('acceptă o reformulare proprie pentru sursa licențiată', async (t) => {
  const contentRoot = await tempDir(t);
  const draft = makeDraft({
    reviewedText:
      'Conducerea aprobă o politică de securitate a informației, o publică pentru întreg personalul și o revizuiește la intervale planificate.',
  });
  await seedDraft(contentRoot, draft);

  const result = await promoteDraft({
    contentRoot,
    frameworkId: 'iso27001',
    draftId: draft.id,
    reviewer: REVIEWER,
    overrides: { reformulated: true },
    now: NOW,
  });

  assert.equal(result.requirement.review.reformulated, true);
  assert.equal(result.requirement.version, '2022.1.0');
});

test('permite suprascrierea titlului, referinței și opririi întrebării', async (t) => {
  const contentRoot = await tempDir(t);
  const draft = makeDraft({
    frameworkId: 'nis2',
    version: '2024.1.0',
    id: 'nis2-art-21-2-a',
    text: 'Text extras din sursa publică, suficient de lung pentru promovare.',
    reviewedText: 'Text revizuit și suficient de lung pentru a trece validarea.',
  });
  await seedDraft(contentRoot, draft);

  const result = await promoteDraft({
    contentRoot,
    frameworkId: 'nis2',
    draftId: draft.id,
    reviewer: REVIEWER,
    overrides: {
      title: 'Politici aprobate de conducere',
      ref: 'Art. 21(2)(a)',
      id: 'nis2-politici-risc',
      noQuestion: true,
    },
    now: NOW,
  });

  assert.equal(result.requirement.id, 'nis2-politici-risc');
  assert.equal(result.requirement.title, 'Politici aprobate de conducere');
  assert.equal(result.question, null);
  assert.equal(result.questionPath, null);
});
