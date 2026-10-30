#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = [
  { frameworkId: "iso27001", version: "2022.1.0" },
  { frameworkId: "soc2", version: "2022.1.0" },
];
const THEMES = new Set([
  "infrastructure",
  "organizational",
  "product",
  "procedures",
  "data_privacy",
]);
const STATUSES = new Set(["draft", "in_review", "published"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function parseArgs(argv) {
  const options = {
    base: join(root, "src", "server", "api", "seed", "library.json"),
    data: join(root, "data", "library.json"),
    seed: join(root, "src", "server", "api", "seed", "library.json"),
    check: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") options.check = true;
    else if (arg === "--base") options.base = resolve(argv[++index]);
    else if (arg === "--data") options.data = resolve(argv[++index]);
    else if (arg === "--seed") options.seed = resolve(argv[++index]);
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node tools/build-library.mjs [--base <path>] [--data <path>] [--seed <path>] [--check]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readBase(path, fallback) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return readJson(fallback);
  }
}

function slugifyRef(ref) {
  return ref
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function requireText(value, label, { min = 1, max = 2000 } = {}) {
  if (typeof value !== "string" || value.trim().length < min) {
    throw new Error(`${label} must be at least ${min} characters.`);
  }
  if (value.length > max) {
    throw new Error(`${label} must be at most ${max} characters.`);
  }
  return value.trim();
}

function loadChecklist(checklist, descriptor) {
  const { frameworkId, version } = descriptor;
  if (checklist.frameworkId !== frameworkId) {
    throw new Error(
      `${frameworkId}/${version}/checklist.json: frameworkId is ${checklist.frameworkId}.`,
    );
  }
  if (checklist.version !== version) {
    throw new Error(
      `${frameworkId}/${version}/checklist.json: version is ${checklist.version}.`,
    );
  }

  const source = checklist.source;
  if (!source || source.frameworkId !== frameworkId) {
    throw new Error(`${frameworkId}/${version}: source.frameworkId is missing or wrong.`);
  }
  if (!/^src-[a-z0-9-]+$/.test(source.id ?? "")) {
    throw new Error(`${frameworkId}/${version}: source id ${source.id} is invalid.`);
  }
  if (source.version !== version) {
    throw new Error(
      `${frameworkId}/${version}: source version ${source.version} does not match.`,
    );
  }
  if (!["public", "proprietary"].includes(source.license)) {
    throw new Error(`${frameworkId}/${version}: unknown source license ${source.license}.`);
  }
  if (!["pdf", "docx", "html", "markdown", "text"].includes(source.kind)) {
    throw new Error(`${frameworkId}/${version}: unknown source kind ${source.kind}.`);
  }
  if (Number.isNaN(Date.parse(source.importedAt))) {
    throw new Error(`${frameworkId}/${version}: source importedAt is not a date.`);
  }
  if (!Array.isArray(checklist.requirements) || checklist.requirements.length === 0) {
    throw new Error(`${frameworkId}/${version}: checklist has no requirements.`);
  }

  const seenRefs = new Set();
  const seenIds = new Set();
  const requirements = checklist.requirements.map((entry, index) => {
    const label = `${frameworkId}/${version} entry ${index + 1}`;
    const ref = requireText(entry.ref, `${label} ref`, { max: 40 });
    if (seenRefs.has(ref.toLowerCase())) {
      throw new Error(`${label}: duplicate ref ${ref}.`);
    }
    seenRefs.add(ref.toLowerCase());

    const id = `req-${frameworkId}-${slugifyRef(ref)}`;
    if (!ID_PATTERN.test(id) || id.length < 3) {
      throw new Error(`${label}: generated id ${id} is invalid.`);
    }
    if (seenIds.has(id)) {
      throw new Error(`${label}: generated id ${id} is duplicated.`);
    }
    seenIds.add(id);

    const title = requireText(entry.title, `${label} title`, { min: 5, max: 200 });
    const text = requireText(entry.text, `${label} text`, { min: 20, max: 2000 });
    if (!THEMES.has(entry.theme)) {
      throw new Error(`${label}: unknown theme ${entry.theme}.`);
    }
    const sourceRef = requireText(entry.sourceRef, `${label} sourceRef`, { min: 3 });
    const status = entry.status ?? "draft";
    if (!STATUSES.has(status)) {
      throw new Error(`${label}: unknown status ${status}.`);
    }

    const review = entry.review ?? checklist.review;
    if (!review || typeof review.reformulated !== "boolean") {
      throw new Error(`${label}: review.reformulated must be a boolean.`);
    }
    if (source.license === "proprietary" && review.reformulated !== true) {
      throw new Error(`${label}: licensed content must set review.reformulated = true.`);
    }
    const reviewer = requireText(review.reviewer, `${label} review.reviewer`, {
      min: 2,
      max: 120,
    });
    const reviewedAt = requireText(review.reviewedAt, `${label} review.reviewedAt`);
    if (Number.isNaN(Date.parse(reviewedAt))) {
      throw new Error(`${label}: review.reviewedAt is not a date.`);
    }

    return {
      id,
      sourceId: source.id,
      frameworkId,
      ref,
      title,
      text,
      theme: entry.theme,
      status,
      reviewer: status === "published" ? reviewer : null,
      reviewedAt: status === "published" ? reviewedAt : null,
      createdAt: source.importedAt,
      sourceRef,
      reformulated: review.reformulated,
    };
  });

  return {
    source: {
      id: source.id,
      frameworkId,
      title: requireText(source.title, `${frameworkId} source title`, { min: 5 }),
      publisher: requireText(source.publisher, `${frameworkId} source publisher`, { min: 2 }),
      version: requireText(source.version, `${frameworkId} source version`),
      kind: source.kind,
      license: source.license,
      importedAt: requireText(source.importedAt, `${frameworkId} source importedAt`),
      lastReviewedAt: source.lastReviewedAt ?? null,
    },
    requirements,
  };
}

export async function buildLibrary({ base, contentRoot = join(root, "content") }) {
  const curated = [];
  for (const descriptor of CATALOG) {
    const path = join(
      contentRoot,
      descriptor.frameworkId,
      descriptor.version,
      "checklist.json",
    );
    curated.push(loadChecklist(await readJson(path), descriptor));
  }

  const sourceIds = new Set(curated.map((entry) => entry.source.id));
  const sources = base.sources.filter((source) => !sourceIds.has(source.id));
  const requirements = base.requirements.filter(
    (requirement) => !sourceIds.has(requirement.sourceId),
  );

  for (const entry of curated) {
    sources.push(entry.source);
    requirements.push(...entry.requirements);
  }

  const updatedAt =
    curated
      .map((entry) => entry.source.importedAt)
      .sort()
      .at(-1) ?? base.updatedAt ?? null;

  return {
    version: base.version ?? 1,
    updatedAt,
    sources,
    requirements,
    documents: base.documents ?? [],
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputs = [];
  for (const path of [options.data, options.seed]) {
    const base = await readBase(path, options.base);
    outputs.push({ path, library: await buildLibrary({ base }) });
  }
  const [primary] = outputs;

  if (options.check) {
    let stale = false;
    for (const { path, library } of outputs) {
      const current = await readFile(path, "utf8").catch(() => "");
      if (current !== `${JSON.stringify(library, null, 2)}\n`) {
        stale = true;
        console.error(`Out of date: ${path}`);
      }
    }
    if (stale) process.exitCode = 1;
    else console.log("Library is up to date.");
    return;
  }

  for (const { path, library } of outputs) {
    await writeFile(path, `${JSON.stringify(library, null, 2)}\n`, "utf8");
  }

  const counts = new Map();
  for (const requirement of primary.library.requirements) {
    counts.set(
      requirement.frameworkId,
      (counts.get(requirement.frameworkId) ?? 0) + 1,
    );
  }
  console.log(
    `Wrote ${primary.library.requirements.length} requirements and ${primary.library.sources.length} sources.`,
  );
  console.log(
    [...counts.entries()]
      .map(([frameworkId, count]) => `${frameworkId}=${count}`)
      .join(" "),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
