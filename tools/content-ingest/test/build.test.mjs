import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { buildBundles } from '../src/build.mjs';
import { loadSchemas, validateBuiltBundle } from '../src/validate.mjs';
import {
  CONTRACTS_ROOT,
  createBundle,
  makeQuestion,
  makeRequirement,
  readJson,
  tempDir,
} from './helpers.mjs';

const silent = () => {};

test('construiește bundle-ul și un manifest verificabil', async (t) => {
  const contentRoot = await tempDir(t);
  const outRoot = await tempDir(t);
  await createBundle(contentRoot, {
    requirements: [makeRequirement()],
    questions: [makeQuestion()],
  });
  await writeFile(join(contentRoot, 'nis2', '2024.1.0', 'changelog.md'), '# Changelog\n');

  const result = await buildBundles({
    contentRoot,
    contractsRoot: CONTRACTS_ROOT,
    outRoot,
    publishedAt: '2026-10-29T12:00:00.000Z',
    log: silent,
  });

  assert.equal(result.built.length, 1);
  const target = join(outRoot, 'nis2', '2024.1.0');
  const manifest = await readJson(join(target, 'manifest.json'));
  assert.equal(manifest.id, 'nis2/2024.1.0');
  assert.equal(manifest.publishedAt, '2026-10-29T12:00:00.000Z');
  assert.equal(manifest.files.length, 4);
  assert.deepEqual(
    manifest.files.map((file) => file.path),
    [
      'changelog.md',
      'framework.json',
      'questions/nis2-art-21-2-a.json',
      'requirements/nis2-art-21-2-a.json',
    ],
  );

  const { schemas } = await loadSchemas(CONTRACTS_ROOT);
  const check = await validateBuiltBundle(target, schemas);
  assert.deepEqual(check.errors, []);
});

test('detectează un fișier modificat după publicare', async (t) => {
  const contentRoot = await tempDir(t);
  const outRoot = await tempDir(t);
  await createBundle(contentRoot, {
    requirements: [makeRequirement()],
    questions: [makeQuestion()],
  });
  await buildBundles({
    contentRoot,
    contractsRoot: CONTRACTS_ROOT,
    outRoot,
    publishedAt: '2026-10-29T12:00:00.000Z',
    log: silent,
  });

  const target = join(outRoot, 'nis2', '2024.1.0');
  const requirementPath = join(target, 'requirements', 'nis2-art-21-2-a.json');
  const requirement = await readJson(requirementPath);
  requirement.text = `${requirement.text} Modificat.`;
  await writeFile(requirementPath, `${JSON.stringify(requirement, null, 2)}\n`, 'utf8');

  const { schemas } = await loadSchemas(CONTRACTS_ROOT);
  const check = await validateBuiltBundle(target, schemas);
  assert.ok(check.errors.some((error) => error.includes('hash diferit')));
});

test('detectează un manifest modificat', async (t) => {
  const contentRoot = await tempDir(t);
  const outRoot = await tempDir(t);
  await createBundle(contentRoot, {
    requirements: [makeRequirement()],
    questions: [makeQuestion()],
  });
  await buildBundles({
    contentRoot,
    contractsRoot: CONTRACTS_ROOT,
    outRoot,
    publishedAt: '2026-10-29T12:00:00.000Z',
    log: silent,
  });

  const target = join(outRoot, 'nis2', '2024.1.0');
  const manifestPath = join(target, 'manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.files[0].sha256 = '0'.repeat(64);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const { schemas } = await loadSchemas(CONTRACTS_ROOT);
  const check = await validateBuiltBundle(target, schemas);
  assert.ok(check.errors.some((error) => error.includes('hash-ul agregat')));
});

test('refuză build-ul când toate bundle-urile sunt goale', async (t) => {
  const contentRoot = await tempDir(t);
  const outRoot = await tempDir(t);
  await createBundle(contentRoot, {});

  await assert.rejects(
    () =>
      buildBundles({
        contentRoot,
        contractsRoot: CONTRACTS_ROOT,
        outRoot,
        log: silent,
      }),
    /Nu s-a construit niciun bundle/,
  );
});

test('refuză build-ul când validarea găsește erori', async (t) => {
  const contentRoot = await tempDir(t);
  const outRoot = await tempDir(t);
  await createBundle(contentRoot, {
    requirements: [makeRequirement()],
    questions: [makeQuestion({ requirementRef: 'Art. 99' })],
  });

  await assert.rejects(
    () =>
      buildBundles({
        contentRoot,
        contractsRoot: CONTRACTS_ROOT,
        outRoot,
        log: silent,
      }),
    /Validarea a eșuat/,
  );
});

test('manifestul nu include manifestul în lista de fișiere', async (t) => {
  const contentRoot = await tempDir(t);
  const outRoot = await tempDir(t);
  await createBundle(contentRoot, {
    requirements: [makeRequirement()],
    questions: [makeQuestion()],
  });
  await buildBundles({
    contentRoot,
    contractsRoot: CONTRACTS_ROOT,
    outRoot,
    publishedAt: '2026-10-29T12:00:00.000Z',
    log: silent,
  });

  const manifest = await readJson(join(outRoot, 'nis2', '2024.1.0', 'manifest.json'));
  assert.ok(manifest.files.every((file) => file.path !== 'manifest.json'));
  assert.match(manifest.hash, /^[a-f0-9]{64}$/);
  const raw = await readFile(join(outRoot, 'nis2', '2024.1.0', 'requirements', 'nis2-art-21-2-a.json'));
  assert.ok(raw.byteLength > 0);
});
