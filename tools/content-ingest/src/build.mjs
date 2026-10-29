import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import {
  listBundles,
  loadBundle,
  loadSchemas,
  validateBundle,
  validateBuiltBundle,
} from './validate.mjs';

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function listFiles(directory, prefix = '') {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(path, key)));
    else if (entry.isFile() && /\.(json|md)$/.test(entry.name)) files.push({ path, key });
  }
  return files;
}

async function optionalFile(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies the reviewed content into an immutable bundle and writes a manifest.
 * Unsigned by default; signing belongs to the publisher with a key outside the repo.
 */
export async function buildBundles({
  contentRoot,
  contractsRoot,
  outRoot,
  frameworkId,
  version,
  publishedAt = new Date().toISOString(),
  log = () => {},
}) {
  const publishedDate = new Date(publishedAt);
  if (Number.isNaN(publishedDate.getTime())) {
    throw new Error(`Data de publicare „${publishedAt}” nu este o dată ISO validă.`);
  }
  publishedAt = publishedDate.toISOString();

  const { schemas } = await loadSchemas(contractsRoot);
  const all = await listBundles(contentRoot);
  const selected = all.filter(
    (bundle) =>
      (!frameworkId || bundle.frameworkId === frameworkId) && (!version || bundle.version === version),
  );

  if (selected.length === 0) {
    throw new Error('Nu există bundle-uri de construit.');
  }

  const built = [];
  const skipped = [];

  for (const descriptor of selected) {
    const bundle = await loadBundle(descriptor);
    const source = `${bundle.frameworkId}/${bundle.version}`;
    const validation = validateBundle(bundle, schemas);

    if (validation.errors.length > 0) {
      throw new Error(
        `Validarea a eșuat pentru ${source}:\n${validation.errors.map((error) => `  - ${error}`).join('\n')}`,
      );
    }
    if (bundle.requirements.length === 0) {
      skipped.push(source);
      log(`sar peste ${source}: nu are cerințe promovate.`);
      continue;
    }

    const target = join(outRoot, bundle.frameworkId, bundle.version);
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });

    await copyFile(bundle.frameworkPath, join(target, 'framework.json'));

    for (const entry of bundle.requirements) {
      await mkdir(join(target, 'requirements'), { recursive: true });
      await copyFile(entry.path, join(target, 'requirements', entry.file));
    }
    for (const entry of bundle.questions) {
      await mkdir(join(target, 'questions'), { recursive: true });
      await copyFile(entry.path, join(target, 'questions', entry.file));
    }
    const changelog = join(bundle.root, 'changelog.md');
    if (await optionalFile(changelog)) await copyFile(changelog, join(target, 'changelog.md'));

    const files = [];
    for (const file of await listFiles(target)) {
      const content = await readFile(file.path);
      files.push({
        path: file.key.split(sep).join('/'),
        sha256: sha256(content),
        bytes: content.byteLength,
      });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));

    const aggregate = sha256(
      Buffer.from(files.map((file) => `${file.path}\u0000${file.sha256}`).join('\n'), 'utf8'),
    );

    const manifest = {
      id: `${bundle.frameworkId}/${bundle.version}`,
      docType: 'manifest',
      frameworkId: bundle.frameworkId,
      version: bundle.version,
      publishedAt,
      hash: aggregate,
      files,
    };

    await writeFile(
      join(target, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );

    const check = await validateBuiltBundle(target, schemas);
    if (check.errors.length > 0) {
      throw new Error(
        `Bundle-ul construit ${source} nu este valid:\n${check.errors.map((error) => `  - ${error}`).join('\n')}`,
      );
    }

    log(
      `construit ${source}: ${files.length} fișiere, ${(relative(outRoot, target) || '.').split(sep).join('/')}`,
    );
    built.push({ source, target, manifest });
  }

  if (built.length === 0) {
    throw new Error(
      `Nu s-a construit niciun bundle. ${skipped.length > 0 ? 'Conținutul nu are cerințe promovate.' : ''}`,
    );
  }

  return { built, skipped };
}
