import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const CONTRACTS_ROOT = join(REPO_ROOT, 'contracts');
export const FIXTURES = join(REPO_ROOT, 'tools/content-ingest/test/fixtures');

export async function tempDir(t) {
  const directory = await mkdtemp(join(tmpdir(), 'comply-ingest-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

export async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export function makeFramework({ frameworkId = 'nis2', version = '2024.1.0', license = 'public' } = {}) {
  return {
    id: `${frameworkId}/${version}`,
    frameworkId,
    version,
    docType: 'framework',
    title:
      frameworkId === 'nis2'
        ? 'NIS2 — Directiva (UE) 2022/2555'
        : frameworkId === 'iso27001'
          ? 'ISO/IEC 27001:2022'
          : 'EU AI Act — Regulamentul (UE) 2024/1689',
    effectiveFrom: '2024-01-01',
    source: 'Sursă de test pentru validare',
    license,
  };
}

export function makeRequirement(overrides = {}) {
  return {
    id: 'nis2-art-21-2-a',
    frameworkId: 'nis2',
    version: '2024.1.0',
    docType: 'requirement',
    ref: 'Art. 21(2)(a)',
    title: 'Politici de analiză a riscurilor',
    text: 'Organizația definește și aprobă politici de analiză a riscurilor, revizuite anual de conducere.',
    theme: 'Guvernanță și risc',
    sourceRef: 'Directiva (UE) 2022/2555, p. 12, l. 34',
    review: {
      reviewer: 'Ana Popescu',
      reviewedAt: '2026-10-29T10:00:00.000Z',
      reformulated: true,
    },
    ...overrides,
  };
}

export function makeQuestion(overrides = {}) {
  return {
    id: 'nis2-art-21-2-a',
    frameworkId: 'nis2',
    version: '2024.1.0',
    docType: 'question',
    requirementRef: 'Art. 21(2)(a)',
    question:
      'Ce dovezi demonstrează că politicile de analiză a riscurilor sunt aprobate și revizuite anual?',
    evidenceType: 'document',
    cadence: 'annual',
    ...overrides,
  };
}

export async function createBundle(
  root,
  { frameworkId = 'nis2', version = '2024.1.0', license = 'public', requirements = [], questions = [] } = {},
) {
  const directory = join(root, frameworkId, version);
  await writeJson(join(directory, 'framework.json'), makeFramework({ frameworkId, version, license }));
  for (const requirement of requirements) {
    await writeJson(join(directory, 'requirements', `${requirement.id}.json`), requirement);
  }
  for (const question of questions) {
    await writeJson(join(directory, 'questions', `${question.id}.json`), question);
  }
  return directory;
}

export function makeDraft(overrides = {}) {
  const source =
    'The organization shall define, approve, publish and communicate an information security policy at the top level, and review it at planned intervals.';
  return {
    docType: 'draft',
    id: 'iso-a-5-1',
    frameworkId: 'iso27001',
    version: '2022.1.0',
    document: 'ISO/IEC 27001:2022',
    ref: 'A.5.1',
    title: 'Politici de securitate a informației',
    theme: 'Controale organizaționale',
    text: source,
    rawText: source,
    sourceRef: 'ISO/IEC 27001:2022, p. 21, l. 4',
    reviewedText: '',
    review: { status: 'needs_review', reviewer: null, reviewedAt: null },
    warnings: [],
    ...overrides,
  };
}
