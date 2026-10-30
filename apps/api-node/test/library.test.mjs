import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { createApiServer } from "../lib/api.mjs";
import { LibraryStore } from "../lib/store.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("serves the curated ISO/IEC 27001 and SOC 2 frameworks from the seed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "comply-library-"));
  const store = new LibraryStore({
    dataDir: join(directory, "data"),
    seedDir: join(HERE, "..", "seed"),
  });
  await store.init();

  const app = createApiServer({
    store,
    dev: true,
    ingestSchedule: { intervalHours: 0, onStart: false },
    mcpKeysDataFile: join(directory, "data", "mcp-keys.json"),
  });
  await app.ready;
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  try {
    const { frameworks } = await fetch(`${base}/api/frameworks`).then((response) =>
      response.json(),
    );
    const byId = Object.fromEntries(
      frameworks.map((framework) => [framework.frameworkId, framework]),
    );

    assert.equal(byId.iso27001.requirements, 93);
    assert.equal(byId.iso27001.sourceId, "src-iso27001-2022");
    assert.equal(byId.iso27001.license, "proprietary");
    assert.equal(byId.soc2.title, "SOC 2");
    assert.equal(byId.soc2.publisher, "AICPA");
    assert.equal(byId.soc2.requirements, 61);
    assert.equal(byId.soc2.sourceId, "src-soc2-2022");
    assert.equal(byId.soc2.license, "proprietary");

    const library = await fetch(`${base}/api/library`).then((response) =>
      response.json(),
    );
    assert.equal(library.sources.length, 4);
    assert.equal(library.requirements.length, 1569);

    const soc2 = library.requirements.filter(
      (requirement) => requirement.frameworkId === "soc2",
    );
    assert.deepEqual(
      soc2.slice(0, 2).map((requirement) => requirement.ref),
      ["CC1.1", "CC1.2"],
    );
    assert.ok(
      soc2.every(
        (requirement) =>
          requirement.sourceId === "src-soc2-2022" && requirement.status === "draft",
      ),
    );
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
