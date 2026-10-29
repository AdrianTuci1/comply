import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { CONTRACTS_ROOT, FIXTURES, REPO_ROOT, readJson, tempDir, writeJson } from './helpers.mjs';

const run = promisify(execFile);
const CLI = join(REPO_ROOT, 'tools/content-ingest/cli.mjs');

async function cli(args) {
  const result = await run(process.execPath, [CLI, ...args], { cwd: REPO_ROOT });
  return result.stdout;
}

test('fluxul complet: extract → promote → validate → build', async (t) => {
  const workspace = await tempDir(t);
  const contentRoot = join(workspace, 'content');
  const outRoot = join(workspace, 'dist');

  const extractOutput = await cli([
    'extract',
    '--framework',
    'nis2',
    '--source',
    join(FIXTURES, 'nis2-sample.txt'),
    '--document',
    'Directiva (UE) 2022/2555',
    '--content',
    contentRoot,
  ]);
  assert.match(extractOutput, /6 drafturi scrise/);

  const draftPath = join(
    contentRoot,
    'nis2',
    '2024.1.0',
    'drafts',
    'nis2-art-21-2-a.json',
  );
  const draft = await readJson(draftPath);
  draft.reviewedText =
    'Conducerea aprobă și revizuiește anual politicile de analiză a riscurilor și standardele de securitate pentru sistemele informatice.';
  await writeJson(draftPath, draft);

  await writeJson(
    join(contentRoot, 'nis2', '2024.1.0', 'framework.json'),
    await readJson(join(REPO_ROOT, 'content', 'nis2', '2024.1.0', 'framework.json')),
  );

  const promoteOutput = await cli([
    'promote',
    '--framework',
    'nis2',
    '--draft',
    'nis2-art-21-2-a',
    '--reviewer',
    'Ana Popescu',
    '--content',
    contentRoot,
  ]);
  assert.match(promoteOutput, /Promovat: nis2-art-21-2-a/);

  const validateOutput = await cli([
    'validate',
    '--content',
    contentRoot,
    '--contracts',
    CONTRACTS_ROOT,
  ]);
  assert.match(validateOutput, /OK nis2\/2024\.1\.0: 1 cerințe, 1 întrebări\./);
  assert.match(validateOutput, /0 erori/);

  const buildOutput = await cli([
    'build',
    '--content',
    contentRoot,
    '--contracts',
    CONTRACTS_ROOT,
    '--out',
    outRoot,
    '--published-at',
    '2026-10-29T12:00:00.000Z',
  ]);
  assert.match(buildOutput, /Bundle-uri construite/);

  const bundleRoot = join(outRoot, 'nis2', '2024.1.0');
  assert.deepEqual((await readdir(bundleRoot)).sort(), [
    'framework.json',
    'manifest.json',
    'questions',
    'requirements',
  ]);
  const manifest = await readJson(join(bundleRoot, 'manifest.json'));
  assert.equal(manifest.files.length, 3);
});

test('--dry-run nu scrie niciun fișier', async (t) => {
  const workspace = await tempDir(t);
  const contentRoot = join(workspace, 'content');

  const output = await cli([
    'extract',
    '--framework',
    'nis2',
    '--source',
    join(FIXTURES, 'nis2-sample.txt'),
    '--dry-run',
    '--content',
    contentRoot,
  ]);
  const drafts = JSON.parse(output);
  assert.equal(drafts.length, 6);
  await assert.rejects(() => readdir(contentRoot), /ENOENT/);
});

test('validate returnează cod 1 la erori', async (t) => {
  const workspace = await tempDir(t);
  const contentRoot = join(workspace, 'content');
  await writeJson(join(contentRoot, 'nis2', '2024.1.0', 'framework.json'), {
    id: 'nis2/2024.1.0',
    frameworkId: 'nis2',
    version: '2024.1.0',
    docType: 'framework',
    title: 'NIS2 — test',
    effectiveFrom: '2024-01-01',
    source: 'Sursă de test',
    license: 'public',
  });
  await writeJson(join(contentRoot, 'nis2', '2024.1.0', 'requirements', 'rupt.json'), {
    id: 'rupt',
    docType: 'requirement',
  });

  await assert.rejects(
    () =>
      run(process.execPath, [CLI, 'validate', '--content', contentRoot, '--contracts', CONTRACTS_ROOT], {
        cwd: REPO_ROOT,
      }),
    (error) => error.code === 1 && /eroare:/.test(error.stdout),
  );
});
