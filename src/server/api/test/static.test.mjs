import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { createApiServer } from "../lib/api.mjs";
import { LibraryStore } from "../lib/store.mjs";

let directory;
let app;
let baseUrl;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "comply-static-"));
  const webRoot = join(directory, "web");
  await mkdir(webRoot, { recursive: true });
  await writeFile(
    join(webRoot, "index.html"),
    "<!doctype html><title>Comply</title>",
  );
  await writeFile(join(webRoot, "main-ABCDEFGH.js"), "console.log('comply');");

  const store = new LibraryStore({
    dataDir: join(directory, "data"),
    seedDir: join(directory, "seed"),
  });
  await store.init();

  app = createApiServer({
    store,
    staticRoot: webRoot,
    dev: false,
    ingestSchedule: { intervalHours: 0, onStart: false },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => app.server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});

test("serves the app shell for client routes", async () => {
  const home = await fetch(`${baseUrl}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type"), /text\/html/);
  assert.equal(home.headers.get("x-content-type-options"), "nosniff");
  assert.match(await home.text(), /Comply/);

  const route = await fetch(`${baseUrl}/workspace/boards/b-nis2-2026`);
  assert.equal(route.status, 200);
  assert.match(await route.text(), /Comply/);
});

test("serves hashed assets with immutable caching", async () => {
  const asset = await fetch(`${baseUrl}/main-ABCDEFGH.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("content-type"), /javascript/);
  assert.match(asset.headers.get("cache-control"), /immutable/);
});

test("keeps API and missing assets out of the SPA fallback", async () => {
  const api = await fetch(`${baseUrl}/api/missing`);
  assert.equal(api.status, 404);
  assert.match(api.headers.get("content-type"), /application\/json/);

  const asset = await fetch(`${baseUrl}/missing.png`);
  assert.equal(asset.status, 404);
  assert.match(asset.headers.get("content-type"), /application\/json/);
});

test("reports how the deployment serves the trust center", async () => {
  const managed = await app.handle({
    method: "GET",
    url: "/api/runtime",
    headers: { host: "localhost" },
  });
  const info = JSON.parse(managed.body);
  assert.equal(info.deployment, "managed");
  assert.equal(info.trust.managedHost, "edge.comply.app");

  const previousHost = process.env.COMPLY_TRUST_HOST;
  const previousSlug = process.env.COMPLY_TRUST_SLUG;
  process.env.COMPLY_TRUST_HOST = "trust.example.com";
  process.env.COMPLY_TRUST_SLUG = "nordwind";
  try {
    const redirect = await app.handle({
      method: "GET",
      url: "/",
      headers: { host: "trust.example.com" },
    });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.location, "/t/nordwind");

    const page = await app.handle({
      method: "GET",
      url: "/t/nordwind",
      headers: { host: "trust.example.com" },
    });
    assert.equal(page.status, 200);
    assert.match(page.headers["content-type"], /text\/html/);
  } finally {
    if (previousHost === undefined) delete process.env.COMPLY_TRUST_HOST;
    else process.env.COMPLY_TRUST_HOST = previousHost;
    if (previousSlug === undefined) delete process.env.COMPLY_TRUST_SLUG;
    else process.env.COMPLY_TRUST_SLUG = previousSlug;
  }
});

test("exposes the same handler for serverless hosts", async () => {
  const result = await app.handle({
    method: "GET",
    url: "/healthz",
    headers: { host: "localhost" },
  });
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(result.body).status, "ok");

  const shell = await app.handle({
    method: "GET",
    url: "/portal/dashboard",
    headers: { host: "localhost" },
  });
  assert.equal(shell.status, 200);
  assert.match(shell.headers["content-type"], /text\/html/);
});
