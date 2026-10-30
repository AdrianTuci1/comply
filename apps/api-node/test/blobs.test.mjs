import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AzureBlobStore,
  LocalBlobStore,
  createBlobStore,
} from "../lib/blobs.mjs";

test("stores and reads local blobs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "comply-blobs-"));
  try {
    const store = createBlobStore({ dataDir: directory });
    assert.ok(store instanceof LocalBlobStore);
    await store.put("documents/a.json", '{"ok":true}');
    assert.equal(
      (await store.get("documents/a.json")).toString(),
      '{"ok":true}',
    );
    assert.equal(await store.get("missing.json"), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("creates a short-lived read SAS for a private container", () => {
  const store = new AzureBlobStore({
    accountName: "complystore",
    accountKey: Buffer.from("test-key").toString("base64"),
    container: "comply",
  });
  const url = new URL(store.signedUrl("documents/a.json", 120));
  assert.equal(url.pathname, "/comply/documents/a.json");
  assert.equal(url.searchParams.get("sp"), "r");
  assert.equal(url.searchParams.get("sr"), "b");
  assert.ok(url.searchParams.get("sig"));
  assert.ok(Date.parse(url.searchParams.get("se")) > Date.now());
});

test("uploads with SharedKey authorization", async () => {
  const calls = [];
  const store = new AzureBlobStore({
    accountName: "complystore",
    accountKey: Buffer.from("test-key").toString("base64"),
    container: "comply",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(null, { status: 201 });
    },
  });

  await store.put("library.json", "{}", "application/json");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "PUT");
  assert.match(
    calls[0].options.headers.authorization,
    /^SharedKey complystore:/,
  );
  assert.equal(calls[0].options.headers["x-ms-blob-type"], "BlockBlob");
});
