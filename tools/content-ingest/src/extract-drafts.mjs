import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { extractDocument } from './extract.mjs';
import { frameworkConfig, slugify } from './frameworks.mjs';
import { segment } from './segment.mjs';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function toDraft(candidate, { document, framework, version, id, extractedAt }) {
  return {
    docType: 'draft',
    id,
    frameworkId: framework.id,
    version,
    document,
    ref: candidate.ref,
    title: candidate.title,
    theme: candidate.theme,
    text: candidate.text,
    rawText: candidate.rawText,
    sourceRef: candidate.sourceRef,
    extractedAt,
    reviewedText: '',
    review: {
      status: 'needs_review',
      reviewer: null,
      reviewedAt: null,
    },
    warnings: candidate.warnings,
  };
}

/**
 * Extracts a document into draft files. Existing drafts are preserved unless
 * `force` is set, so a reviewer can re-run extraction without losing edits.
 */
export async function extractToDrafts({
  contentRoot,
  frameworkId,
  sourcePath,
  document,
  version,
  force = false,
  dryRun = false,
  now = new Date(),
}) {
  const framework = frameworkConfig(frameworkId);
  const resolvedVersion = version ?? framework.defaultVersion;
  const label = document?.trim() || framework.defaultSource;

  const extracted = await extractDocument(sourcePath);
  if (extracted.entries.length === 0) {
    throw new Error(`Documentul ${sourcePath} nu conține text selectabil.`);
  }

  const segmented = segment(extracted.entries, framework, { document: label });
  const draftsRoot = join(contentRoot, framework.dir, resolvedVersion, 'drafts');

  if (segmented.candidates.length === 0) {
    return {
      framework,
      version: resolvedVersion,
      draftsRoot,
      written: [],
      skipped: [],
      warnings: [...segmented.warnings, 'Nu s-a creat niciun draft.'],
      candidateCount: 0,
    };
  }

  if (!dryRun) await mkdir(draftsRoot, { recursive: true });

  const used = new Set();
  const written = [];
  const skipped = [];
  const drafts = [];

  for (const candidate of segmented.candidates) {
    let id = slugify(`${framework.id}-${candidate.ref}`, 72);
    let suffix = 2;
    while (used.has(id)) id = `${slugify(`${framework.id}-${candidate.ref}`, 68)}-${suffix++}`;
    used.add(id);

    const draft = toDraft(candidate, {
      document: label,
      framework,
      version: resolvedVersion,
      id,
      extractedAt: now.toISOString(),
    });
    drafts.push(draft);

    if (dryRun) continue;

    const path = join(draftsRoot, `${id}.json`);
    if (!force && (await exists(path))) {
      skipped.push({ id, path });
      continue;
    }
    await writeFile(path, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
    written.push({ id, path });
  }

  return {
    framework,
    version: resolvedVersion,
    draftsRoot,
    written,
    skipped,
    drafts,
    warnings: segmented.warnings,
    candidateCount: segmented.candidates.length,
    documentLabel: label,
    pages: extracted.pages,
    extractedAt: now.toISOString(),
  };
}
