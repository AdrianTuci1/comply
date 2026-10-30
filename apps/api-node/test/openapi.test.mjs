import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { createStaticHandler } from "../lib/static.mjs";

const docsRoot = join(process.cwd(), "apps", "web", "public");

async function readSpec() {
  return JSON.parse(
    await readFile(join(docsRoot, "docs", "openapi.json"), "utf8"),
  );
}

function collectRefs(value, refs = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
  } else if (value && typeof value === "object") {
    if (typeof value.$ref === "string") refs.add(value.$ref);
    for (const item of Object.values(value)) collectRefs(item, refs);
  }
  return refs;
}

function resolvePointer(spec, pointer) {
  return pointer
    .replace(/^#\//, "")
    .split("/")
    .reduce((value, key) => value?.[key], spec);
}

test("documents the public API and MCP surface", async () => {
  const spec = await readSpec();
  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.info.title, "Comply API");
  assert.equal(spec.servers[0].url, "/");

  for (const path of [
    "/healthz",
    "/api/runtime",
    "/api/library",
    "/api/frameworks",
    "/api/documents/{id}",
    "/api/agent/assessments/{id}",
    "/api/agent/boards",
    "/api/access/keys",
    "/api/ingest",
    "/api/auth/login",
    "/api/auth/me",
    "/mcp",
  ]) {
    assert.ok(spec.paths[path], `Missing path ${path}`);
  }

  const operationIds = new Set();
  for (const item of Object.values(spec.paths)) {
    for (const operation of Object.values(item)) {
      if (!operation?.operationId) continue;
      assert.equal(
        operationIds.has(operation.operationId),
        false,
        `Duplicate operationId ${operation.operationId}`,
      );
      operationIds.add(operation.operationId);
    }
  }

  const missing = [...collectRefs(spec)].filter(
    (ref) => resolvePointer(spec, ref) === undefined,
  );
  assert.deepEqual(missing, []);
});

test("serves the Scalar reference and its OpenAPI contract", async () => {
  const serve = createStaticHandler(docsRoot);

  const page = await serve("/docs/");
  assert.equal(page.status, 200);
  assert.match(page.headers["content-type"], /text\/html/);
  assert.match(
    page.body.toString(),
    /\/docs\/vendor\/scalar-1\.76\.2-1a98470f\.js/,
  );
  assert.match(page.body.toString(), /\/docs\/openapi\.json/);
  assert.doesNotMatch(page.body.toString(), /cdn\.jsdelivr\.net/);

  const scalar = await serve("/docs/vendor/scalar-1.76.2-1a98470f.js");
  assert.equal(scalar.status, 200);
  assert.match(scalar.headers["content-type"], /javascript/);
  assert.match(scalar.headers["cache-control"], /immutable/);

  const noSlash = await serve("/docs");
  assert.equal(noSlash.status, 200);
  assert.match(noSlash.headers["content-type"], /text\/html/);

  const contract = await serve("/docs/openapi.json");
  assert.equal(contract.status, 200);
  assert.match(contract.headers["content-type"], /application\/json/);
  assert.equal(JSON.parse(contract.body.toString()).info.title, "Comply API");
});
