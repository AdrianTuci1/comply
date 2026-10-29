import { createHash as nodeHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { FRAMEWORKS, FRAMEWORK_IDS } from './frameworks.mjs';

const SCHEMA_FILES = {
  requirement: 'requirement.schema.json',
  question: 'question.schema.json',
  framework: 'framework.schema.json',
  manifest: 'manifest.schema.json',
};

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function loadSchemas(contractsRoot) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const schemas = {};
  for (const [name, file] of Object.entries(SCHEMA_FILES)) {
    schemas[name] = ajv.compile(await readJson(join(contractsRoot, 'content', file)));
  }
  return { ajv, schemas };
}

function formatSchemaErrors(errors = []) {
  return errors.map((error) => {
    const path = error.instancePath || '(rădăcină)';
    return `${path} ${error.message}`;
  });
}

async function listJsonFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/** All framework versions that contain a framework.json. */
export async function listBundles(contentRoot) {
  const bundles = [];
  for (const frameworkId of FRAMEWORK_IDS) {
    const config = FRAMEWORKS[frameworkId];
    const frameworkRoot = join(contentRoot, config.dir);
    let versions = [];
    try {
      versions = (await readdir(frameworkRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }

    for (const version of versions) {
      const root = join(frameworkRoot, version);
      try {
        await stat(join(root, 'framework.json'));
      } catch {
        continue;
      }
      bundles.push({ frameworkId, version, root });
    }
  }
  return bundles;
}

export async function loadBundle({ frameworkId, version, root }) {
  const frameworkPath = join(root, 'framework.json');
  const framework = await readJson(frameworkPath);
  const requirements = [];
  const questions = [];

  for (const file of await listJsonFiles(join(root, 'requirements'))) {
    requirements.push({ file, path: join(root, 'requirements', file), data: await readJson(join(root, 'requirements', file)) });
  }
  for (const file of await listJsonFiles(join(root, 'questions'))) {
    questions.push({ file, path: join(root, 'questions', file), data: await readJson(join(root, 'questions', file)) });
  }

  return { frameworkId, version, root, frameworkPath, framework, requirements, questions };
}

function checkFileId(file, id, label, errors) {
  const expected = basename(file, '.json');
  if (id !== expected) {
    errors.push(`${label} ${file}: id „${id}” nu corespunde numelui fișierului „${expected}”.`);
  }
}

function normaliseText(text) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Structural and cross-reference checks that JSON Schema cannot express.
 */
export function validateBundle(bundle, schemas) {
  const errors = [];
  const warnings = [];
  const { framework, frameworkId, version } = bundle;
  const source = `${frameworkId}/${version}`;

  if (!schemas.framework(framework)) {
    errors.push(
      ...formatSchemaErrors(schemas.framework.errors).map(
        (message) => `${source}/framework.json: ${message}`,
      ),
    );
  }
  if (framework.frameworkId !== frameworkId) {
    errors.push(
      `${source}/framework.json: frameworkId „${framework.frameworkId}” nu corespunde folderului „${frameworkId}”.`,
    );
  }
  if (framework.version !== version) {
    errors.push(
      `${source}/framework.json: version „${framework.version}” nu corespunde folderului „${version}”.`,
    );
  }
  if (framework.id !== `${frameworkId}/${version}`) {
    errors.push(
      `${source}/framework.json: id „${framework.id}” trebuie să fie „${frameworkId}/${version}”.`,
    );
  }

  const requirementIds = new Set();
  const requirementRefs = new Map();
  const texts = new Map();
  const questionIds = new Set();

  for (const { file, data } of bundle.requirements) {
    if (!schemas.requirement(data)) {
      errors.push(
        ...formatSchemaErrors(schemas.requirement.errors).map(
          (message) => `${source}/requirements/${file}: ${message}`,
        ),
      );
      continue;
    }

    checkFileId(file, data.id, `${source}/requirements`, errors);
    if (data.frameworkId !== frameworkId) {
      errors.push(`${source}/requirements/${file}: frameworkId „${data.frameworkId}” nu corespunde.`);
    }
    if (data.version !== version) {
      errors.push(`${source}/requirements/${file}: version „${data.version}” nu corespunde.`);
    }
    if (requirementIds.has(data.id)) {
      errors.push(`${source}/requirements/${file}: id duplicat „${data.id}”.`);
    }
    requirementIds.add(data.id);

    if (requirementRefs.has(data.ref)) {
      errors.push(
        `${source}/requirements/${file}: referința „${data.ref}” este deja folosită de ${requirementRefs.get(data.ref)}.`,
      );
    }
    requirementRefs.set(data.ref, `${file}`);

    const textKey = normaliseText(data.text);
    if (texts.has(textKey)) {
      errors.push(
        `${source}/requirements/${file}: text identic cu ${texts.get(textKey)}. Fiecare cerință trebuie să aibă formulare proprie.`,
      );
    }
    texts.set(textKey, file);

    if (framework.license === 'proprietary' && data.review?.reformulated !== true) {
      errors.push(
        `${source}/requirements/${file}: sursa este licențiată; lipsește review.reformulated=true.`,
      );
    }
    if (data.text.length > 2000) {
      errors.push(`${source}/requirements/${file}: textul depășește 2000 de caractere.`);
    }
  }

  for (const { file, data } of bundle.questions) {
    if (!schemas.question(data)) {
      errors.push(
        ...formatSchemaErrors(schemas.question.errors).map(
          (message) => `${source}/questions/${file}: ${message}`,
        ),
      );
      continue;
    }

    checkFileId(file, data.id, `${source}/questions`, errors);
    if (data.frameworkId !== frameworkId) {
      errors.push(`${source}/questions/${file}: frameworkId „${data.frameworkId}” nu corespunde.`);
    }
    if (data.version !== version) {
      errors.push(`${source}/questions/${file}: version „${data.version}” nu corespunde.`);
    }
    if (questionIds.has(data.id)) {
      errors.push(`${source}/questions/${file}: id duplicat „${data.id}”.`);
    }
    questionIds.add(data.id);

    if (!requirementRefs.has(data.requirementRef)) {
      errors.push(
        `${source}/questions/${file}: requirementRef „${data.requirementRef}” nu există în requirements/.`,
      );
    }
  }

  if (bundle.requirements.length === 0) {
    warnings.push(`${source}: bundle-ul nu conține încă cerințe.`);
  } else {
    const withQuestions = new Set(bundle.questions.map(({ data }) => data.requirementRef));
    const missing = [...requirementRefs.keys()].filter((ref) => !withQuestions.has(ref));
    if (missing.length > 0) {
      warnings.push(
        `${source}: ${missing.length} cerințe nu au întrebare de dovezi (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}).`,
      );
    }
  }

  return {
    errors,
    warnings,
    counts: {
      requirements: bundle.requirements.length,
      questions: bundle.questions.length,
    },
  };
}

export async function validateAll({ contentRoot, contractsRoot, frameworkId, version, log = () => {} }) {
  const { schemas } = await loadSchemas(contractsRoot);
  const all = await listBundles(contentRoot);
  const selected = all.filter(
    (bundle) =>
      (!frameworkId || bundle.frameworkId === frameworkId) && (!version || bundle.version === version),
  );

  if (selected.length === 0) {
    throw new Error(
      `Nu există bundle-uri de validat${frameworkId ? ` pentru ${frameworkId}` : ''}${version ? `/${version}` : ''}.`,
    );
  }

  const results = [];
  for (const bundle of selected) {
    const loaded = await loadBundle(bundle);
    const result = validateBundle(loaded, schemas);
    results.push({ source: `${bundle.frameworkId}/${bundle.version}`, ...result });
    for (const warning of result.warnings) log(`avertisment: ${warning}`);
    for (const error of result.errors) log(`eroare: ${error}`);
  }

  const errors = results.flatMap((result) => result.errors);
  const warnings = results.flatMap((result) => result.warnings);
  return { results, errors, warnings };
}

/** Validates a built bundle directory: manifest content and file hashes. */
export async function validateBuiltBundle(root, schemas) {
  const hashFile = (buffer) => nodeHash('sha256').update(buffer).digest('hex');
  const errors = [];
  const manifestPath = join(root, 'manifest.json');
  const manifest = await readJson(manifestPath);

  if (!schemas.manifest(manifest)) {
    errors.push(
      ...formatSchemaErrors(schemas.manifest.errors).map((message) => `manifest.json: ${message}`),
    );
    return { errors, manifest };
  }

  for (const entry of manifest.files) {
    try {
      const content = await readFile(join(root, entry.path));
      const digest = hashFile(content);
      if (digest !== entry.sha256) {
        errors.push(`manifest.json: hash diferit pentru ${entry.path}.`);
      }
      if (content.byteLength !== entry.bytes) {
        errors.push(`manifest.json: dimensiune diferită pentru ${entry.path}.`);
      }
    } catch {
      errors.push(`manifest.json: fișierul ${entry.path} lipsește.`);
    }
  }

  const fileKeys = manifest.files.map((entry) => `${entry.path}\u0000${entry.sha256}`).join('\n');
  const expected = hashFile(Buffer.from(fileKeys, 'utf8'));
  if (manifest.hash !== expected) {
    errors.push('manifest.json: hash-ul agregat nu corespunde listei de fișiere.');
  }

  return { errors, manifest };
}
