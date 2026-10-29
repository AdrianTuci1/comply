import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

export const DEFAULT_DATA_DIR = join(REPO_ROOT, "data");
export const DEFAULT_SEED_DIR = resolve(HERE, "../seed");

export const EMPTY_LIBRARY = {
  version: 1,
  updatedAt: null,
  sources: [],
  requirements: [],
  documents: [],
};

export class LibraryStore {
  constructor({ dataDir = DEFAULT_DATA_DIR, seedDir = DEFAULT_SEED_DIR, blobs = null } = {}) {
    this.dataDir = dataDir;
    this.seedDir = seedDir;
    this.blobs = blobs;
    this.library = structuredClone(EMPTY_LIBRARY);
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });
    let local = await readJson(join(this.dataDir, "library.json"));
    if (!local && this.blobs) {
      const remote = await this.blobs.get("library.json").catch(() => null);
      if (remote) local = JSON.parse(remote.toString("utf8"));
    }
    const seed = local ?? (await readJson(join(this.seedDir, "library.json")));

    if (seed) {
      this.library = normalizeLibrary(seed);
    }
    return this.library;
  }

  snapshot() {
    return structuredClone(this.library);
  }

  async saveSource(source, requirements = []) {
    this.library.sources = this.library.sources.filter(
      (item) => item.id !== source.id,
    );
    this.library.sources.push(source);

    const kept = this.library.requirements.filter(
      (item) => item.sourceId !== source.id,
    );
    // References are only unique inside a framework: NIS2 and the AI Act both
    // have an "Art. 1(1)", so a global set would silently drop real controls.
    const seen = new Set(
      kept
        .filter((item) => item.frameworkId === source.frameworkId)
        .map((item) => item.ref.toLowerCase()),
    );
    const added = requirements.filter((item) => {
      const key = item.ref.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    this.library.requirements = [...kept, ...added];
    await this.persist();
    return { source, added: added.length };
  }

  async saveSourceRecord(source) {
    const index = this.library.sources.findIndex(
      (item) => item.id === source.id,
    );
    if (index < 0) {
      this.library.sources.push(source);
    } else {
      this.library.sources[index] = source;
    }
    await this.persist();
    return source;
  }

  async saveRequirement(requirement) {
    const index = this.library.requirements.findIndex(
      (item) => item.id === requirement.id,
    );
    if (index < 0) {
      this.library.requirements.push(requirement);
    } else {
      this.library.requirements[index] = requirement;
    }
    await this.persist();
    return requirement;
  }

  async applyIngest({ source, document, requirements }) {
    const { pages: _pages, ...metadata } = document;

    this.library.sources = this.library.sources.filter(
      (item) => item.id !== source.id,
    );
    this.library.sources.push(source);

    const kept = this.library.requirements.filter(
      (item) => item.sourceId !== source.id,
    );
    const seen = new Set(
      kept
        .filter((item) => item.frameworkId === source.frameworkId)
        .map((item) => item.ref.toLowerCase()),
    );
    const added = [];
    for (const requirement of requirements) {
      const key = requirement.ref.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      added.push(requirement);
    }

    this.library.requirements = [...kept, ...added];
    this.library.documents = this.library.documents.filter(
      (item) => item.id !== document.id,
    );
    this.library.documents.push(metadata);

    await mkdir(join(this.dataDir, "documents"), { recursive: true });
    await writeJson(
      join(this.dataDir, "documents", `${safeId(document.id)}.json`),
      document,
    );
    await this.blobs
      ?.put(
        `documents/${safeId(document.id)}.json`,
        JSON.stringify(document),
        "application/json; charset=utf-8",
      )
      .catch((error) => console.warn("Document blob was not written.", error));
    await this.persist();

    return { source, added: added.length, document: metadata };
  }

  async getDocument(id) {
    const fromData = await readJson(
      join(this.dataDir, "documents", `${safeId(id)}.json`),
    );
    if (fromData) return fromData;
    const fromSeed = await readJson(
      join(this.seedDir, "documents", `${safeId(id)}.json`),
    );
    if (fromSeed) return fromSeed;
    if (!this.blobs) return null;
    const remote = await this.blobs.get(`documents/${safeId(id)}.json`).catch(() => null);
    return remote ? JSON.parse(remote.toString("utf8")) : null;
  }

  async persist() {
    // Saves can arrive together (requirement + source review); serialize them so
    // the temporary file is never renamed twice.
    const task = async () => {
      this.library.updatedAt = new Date().toISOString();
      await writeJson(join(this.dataDir, "library.json"), this.library);
      await this.blobs
        ?.put("library.json", JSON.stringify(this.library), "application/json; charset=utf-8")
        .catch((error) => console.warn("Library blob was not written.", error));
    };
    this.writeQueue = this.writeQueue.then(task, task);
    await this.writeQueue;
  }
}

function normalizeLibrary(value) {
  const library = {
    version: value.version ?? 1,
    updatedAt: value.updatedAt ?? null,
    sources: Array.isArray(value.sources) ? value.sources : [],
    requirements: Array.isArray(value.requirements) ? value.requirements : [],
    documents: Array.isArray(value.documents) ? value.documents : [],
  };

  const sourceIds = new Set(library.sources.map((item) => item.id));
  library.requirements = library.requirements.filter((item) =>
    sourceIds.has(item.sourceId),
  );
  return library;
}

function safeId(value) {
  const id = String(value ?? "");
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw new Error("Invalid document id.");
  return id;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}
