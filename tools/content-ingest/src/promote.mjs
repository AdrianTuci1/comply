import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { frameworkConfig, slugify } from './frameworks.mjs';
import { compareForReformulation } from './reformulation.mjs';

const MIN_REVIEWER = 3;

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function draftsDir(contentRoot, framework, version) {
  return join(contentRoot, framework.dir, version, 'drafts');
}

async function findDraft(contentRoot, framework, draftId, version) {
  if (version) {
    const path = join(await draftsDir(contentRoot, framework, version), `${draftId}.json`);
    return { path, draft: await readJson(path) };
  }

  const frameworkRoot = join(contentRoot, framework.dir);
  const versions = (await readdir(frameworkRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const candidate of versions) {
    const path = join(frameworkRoot, candidate, 'drafts', `${draftId}.json`);
    try {
      return { path, draft: await readJson(path) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`Draftul „${draftId}” nu există pentru ${framework.label}.`);
}

function buildQuestion({ id, framework, version, requirementRef, title, draft, overrides }) {
  const evidenceType = overrides.evidence ?? draft.evidenceType ?? framework.defaultEvidence;
  const cadence = overrides.cadence ?? draft.cadence ?? framework.defaultCadence;
  const explicit = overrides.question ?? draft.question;
  const generated = `Ce dovezi demonstrează că ${title.charAt(0).toLowerCase()}${title.slice(1)}?`;
  let question = explicit?.trim() || generated;

  if (question.length < 20) {
    question = `Ce dovezi demonstrează că ${question.replace(/[?.!]+$/, '')}?`;
  }
  if (question.length > 400) question = `${question.slice(0, 395).trim()}…?`;

  return {
    id,
    frameworkId: framework.id,
    version,
    docType: 'question',
    requirementRef,
    question,
    evidenceType,
    cadence,
    ...(draft.verifier ? { verifier: draft.verifier } : {}),
    ...(draft.threshold ? { threshold: draft.threshold } : {}),
  };
}

/**
 * Promotes one reviewed draft into a requirement (and its evidence question).
 * The draft is never deleted: it keeps provenance for the reviewer.
 */
export async function promoteDraft({
  contentRoot,
  frameworkId,
  draftId,
  reviewer,
  version,
  overrides = {},
  now = new Date(),
}) {
  if (!reviewer || reviewer.trim().length < MIN_REVIEWER) {
    throw new Error('Promovarea cere --reviewer "Numele recenzorului" (minimum 3 caractere).');
  }
  const framework = frameworkConfig(frameworkId);
  const found = await findDraft(contentRoot, framework, draftId, version);
  const draft = found.draft;

  if (draft.docType !== 'draft') {
    throw new Error(`Fișierul ${found.path} nu este un draft.`);
  }
  if (draft.frameworkId !== framework.id) {
    throw new Error(`Draftul aparține framework-ului ${draft.frameworkId}, nu ${framework.id}.`);
  }

  const resolvedVersion = version ?? draft.version ?? framework.defaultVersion;
  const text = (overrides.text ?? draft.reviewedText ?? '').trim();
  if (text.length < framework.minText) {
    throw new Error(
      `Draftul nu are text revizuit. Completează câmpul "reviewedText" sau folosește --text-file (minimum ${framework.minText} caractere).`,
    );
  }
  if (text.length > framework.maxText) {
    throw new Error(`Textul depășește ${framework.maxText} caractere. Împarte cerința în două.`);
  }

  const reformulated = Boolean(overrides.reformulated ?? draft.reformulated);
  if (framework.license === 'proprietary') {
    if (!reformulated) {
      throw new Error(
        'Sursa este licențiată. Treci --reformulated după ce ai rescris textul în formulare proprie.',
      );
    }
    const check = compareForReformulation(text, draft.rawText ?? draft.text ?? '');
    if (!check.ok) throw new Error(`Verificare reformulare: ${check.reason}`);
  }

  const title = (overrides.title ?? draft.title ?? '').trim();
  if (title.length < 5) throw new Error('Titlul trebuie să aibă cel puțin 5 caractere.');

  const ref = (overrides.ref ?? draft.ref ?? '').trim();
  if (!ref) throw new Error('Referința (de exemplu „Art. 21(2)(a)” sau „A.5.1”) lipsește.');

  const id = slugify(overrides.id ?? draft.id ?? `${framework.id}-${ref}`);
  const theme = (overrides.theme ?? draft.theme ?? '').trim() || framework.themeFor({ ref, title, text });
  const reviewedAt = now.toISOString();

  const requirement = {
    id,
    frameworkId: framework.id,
    version: resolvedVersion,
    docType: 'requirement',
    ref,
    title,
    text,
    theme,
    sourceRef: draft.sourceRef,
    review: {
      reviewer: reviewer.trim(),
      reviewedAt,
      reformulated,
    },
  };

  const question = overrides.noQuestion
    ? null
    : {
        ...buildQuestion({
          id,
          framework,
          version: resolvedVersion,
          requirementRef: ref,
          title,
          draft,
          overrides,
        }),
        review: requirement.review,
      };

  const versionRoot = join(contentRoot, framework.dir, resolvedVersion);
  const requirementPath = join(versionRoot, 'requirements', `${id}.json`);
  const questionPath = join(versionRoot, 'questions', `${id}.json`);
  await mkdir(join(versionRoot, 'requirements'), { recursive: true });
  await writeFile(requirementPath, `${JSON.stringify(requirement, null, 2)}\n`, 'utf8');

  if (question) {
    await mkdir(join(versionRoot, 'questions'), { recursive: true });
    await writeFile(questionPath, `${JSON.stringify(question, null, 2)}\n`, 'utf8');
  }

  const updatedDraft = {
    ...draft,
    review: {
      status: 'promoted',
      reviewer: reviewer.trim(),
      reviewedAt,
      requirementId: id,
      reformulated,
    },
  };
  await writeFile(found.path, `${JSON.stringify(updatedDraft, null, 2)}\n`, 'utf8');

  return {
    requirementPath,
    questionPath: question ? questionPath : null,
    requirement,
    question,
  };
}
