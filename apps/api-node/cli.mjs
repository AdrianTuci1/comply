#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  INGESTABLE_FRAMEWORKS,
  SOURCE_REGISTRY,
  runIngest,
} from "./lib/ingest/index.mjs";
import {
  DEFAULT_DATA_DIR,
  DEFAULT_SEED_DIR,
  LibraryStore,
} from "./lib/store.mjs";

const HELP = `comply-content — official document pipeline.

Usage:
  node apps/api-node/cli.mjs <command> [options]

Commands:
  ingest     Download the official documents and extract the requirements.
  list       Show the library served by the API.

Options:
  --framework <id>    ${INGESTABLE_FRAMEWORKS.join(" | ")} | all (default: all)
  --seed              write to apps/api-node/seed (the shipped content)
  --out <dir>         library directory (default: data/)
  --documents <dir>   document directory (default: <out>/documents)
  --concurrency <n>   concurrent requests (default: 4)
  --dry-run           extract and print the counts without writing
  --json              machine-readable result
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const [key, inline] = token.slice(2).split("=");
    if (inline !== undefined) {
      args[key] = inline;
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[key] = next;
      index++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function frameworksFrom(args) {
  const requested = args.framework === true ? "all" : (args.framework ?? "all");
  if (requested === "all") return INGESTABLE_FRAMEWORKS;
  if (!INGESTABLE_FRAMEWORKS.includes(requested)) {
    throw new Error(
      `Unknown framework: ${requested}. Values: ${INGESTABLE_FRAMEWORKS.join(", ")}.`,
    );
  }
  return [requested];
}

async function commandIngest(args) {
  const frameworks = frameworksFrom(args);
  const seed = Boolean(args.seed);
  const outDir = resolve(
    args.out ?? (seed ? DEFAULT_SEED_DIR : DEFAULT_DATA_DIR),
  );
  const documentsDir = resolve(args.documents ?? join(outDir, "documents"));
  const concurrency = Number(args.concurrency ?? 4);
  const log = args.json ? () => {} : (message) => console.log(message);

  log(`Downloading ${frameworks.join(", ")} from the public sources...`);
  const results = [];

  for (const framework of frameworks) {
    const result = await runIngest(framework, { concurrency, log });
    results.push(result);
    log(
      `${framework}: ${result.requirements.length} requirements from ${result.document.pages.length} pages (${Math.round(result.document.bytes / 1024)} KB).`,
    );
  }

  if (args["dry-run"]) {
    if (args.json) {
      console.log(
        JSON.stringify(
          results.map((result) => ({
            framework: result.source.frameworkId,
            requirements: result.requirements.length,
            pages: result.document.pages.length,
            bytes: result.document.bytes,
          })),
          null,
          2,
        ),
      );
    }
    return;
  }

  if (seed) {
    const library = {
      version: 1,
      updatedAt: new Date().toISOString(),
      sources: results.map((result) => result.source),
      requirements: results.flatMap((result) => result.requirements),
      documents: results.map(
        ({ document: { pages: _pages, ...metadata } }) => metadata,
      ),
    };

    await mkdir(documentsDir, { recursive: true });
    for (const result of results) {
      await writeFile(
        join(documentsDir, `${result.document.id}.json`),
        `${JSON.stringify(result.document, null, 2)}\n`,
        "utf8",
      );
    }
    await writeFile(
      join(outDir, "library.json"),
      `${JSON.stringify(library, null, 2)}\n`,
      "utf8",
    );
    log(`Seed written to ${outDir}.`);
  } else {
    const store = new LibraryStore({ dataDir: outDir });
    await store.init();
    for (const result of results) {
      await store.applyIngest(result);
    }
    log(`Library updated in ${outDir}.`);
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        results.map((result) => ({
          framework: result.source.frameworkId,
          sourceId: result.source.id,
          requirements: result.requirements.length,
          pages: result.document.pages.length,
          bytes: result.document.bytes,
        })),
        null,
        2,
      ),
    );
  }
}

async function commandList(args) {
  const store = new LibraryStore({
    dataDir: resolve(args.out ?? DEFAULT_DATA_DIR),
    seedDir: DEFAULT_SEED_DIR,
  });
  const library = await store.init();
  const rows = SOURCE_REGISTRY.map((source) => {
    const stored = library.sources.find(
      (item) => item.frameworkId === source.frameworkId,
    );
    const requirements = stored
      ? library.requirements.filter((item) => item.sourceId === stored.id)
      : [];
    return {
      framework: source.frameworkId,
      title: stored?.title ?? source.title,
      requirements: requirements.length,
      published: requirements.filter((item) => item.status === "published")
        .length,
      documents: library.documents.filter(
        (item) => item.frameworkId === source.frameworkId,
      ).length,
      connector: source.connector ? "downloadable" : "upload only",
    };
  });

  if (args.json) {
    console.log(
      JSON.stringify({ updatedAt: library.updatedAt, sources: rows }, null, 2),
    );
    return;
  }

  for (const row of rows) {
    console.log(
      `${row.framework.padEnd(9)} ${String(row.requirements).padStart(4)} requirements, ${String(row.documents).padStart(2)} documents  ${row.connector}  ${row.title}`,
    );
  }
  console.log(`Updated: ${library.updatedAt ?? "—"}`);
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

try {
  if (!command || command === "help" || args.help) {
    console.log(HELP);
  } else if (command === "ingest") {
    await commandIngest(args);
  } else if (command === "list") {
    await commandList(args);
  } else {
    console.error(`Unknown command: ${command}`);
    console.log(HELP);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
