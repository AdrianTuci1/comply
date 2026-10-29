import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { createApiServer } from "../lib/api.mjs";
import { createAuth } from "../lib/auth.mjs";
import { createOidc } from "../lib/oidc.mjs";
import { LibraryStore } from "../lib/store.mjs";
import { UserRegistry } from "../lib/users.mjs";

let directory;
let app;
let baseUrl;
let store;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "comply-api-"));
  store = new LibraryStore({
    dataDir: join(directory, "data"),
    seedDir: join(directory, "seed"),
  });
  await store.init();

  const users = new UserRegistry({
    dataFile: join(directory, "data", "users.json"),
    now: () => new Date("2026-10-29T10:00:00Z"),
    seeds: [
      {
        email: "adrian@comply.ro",
        password: "comply-demo",
        name: "Adrian",
        organizationName: "Nordwind Logistics",
      },
    ],
  });
  await users.init();

  const auth = createAuth({
    secret: "test-secret",
    now: () => Date.parse("2026-10-29T10:00:00Z"),
    users,
  });
  const oidc = createOidc({ providers: [], auth, users });
  app = createApiServer({
    store,
    auth,
    users,
    oidc,
    dev: true,
    demoLogin: { email: "adrian@comply.ro", password: "comply-demo" },
    ingestSchedule: { intervalHours: 0, onStart: false },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => app.server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});

test("serves health and an empty library", async () => {
  const health = await fetch(`${baseUrl}/healthz`).then((response) =>
    response.json(),
  );
  assert.equal(health.status, "ok");

  const library = await fetch(`${baseUrl}/api/library`).then((response) =>
    response.json(),
  );
  assert.deepEqual(library.sources, []);
  assert.deepEqual(library.requirements, []);
});

test("reports the autonomous ingest schedule", async () => {
  const response = await fetch(`${baseUrl}/api/ingest/schedule`);
  assert.equal(response.status, 200);
  const { schedule } = await response.json();
  assert.equal(schedule.enabled, false);
  assert.equal(schedule.intervalHours, 0);
  assert.equal(schedule.nextRunAt, null);
  assert.equal(schedule.running, null);
});

test("stores a source and its requirements", async () => {
  const now = "2026-10-29T10:00:00.000Z";
  const source = {
    id: "src-test",
    frameworkId: "nis2",
    title: "Test directive",
    publisher: "European Union",
    version: "2024.1.0",
    kind: "html",
    license: "public",
    importedAt: now,
    lastReviewedAt: null,
  };
  const requirement = {
    id: "req-test-1",
    sourceId: source.id,
    frameworkId: "nis2",
    ref: "Art. 1",
    title: "Scope",
    text: "The directive applies to essential entities.",
    theme: "organizational",
    status: "draft",
    reviewer: null,
    reviewedAt: null,
    createdAt: now,
  };

  await store.saveSource(source, [requirement]);

  const library = await fetch(`${baseUrl}/api/library`).then((response) =>
    response.json(),
  );
  assert.equal(library.sources.length, 1);
  assert.equal(library.requirements.length, 1);
  assert.equal(library.requirements[0].ref, "Art. 1");

  const write = await fetch(`${baseUrl}/api/library/sources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source, requirements: [requirement] }),
  });
  assert.equal(write.status, 404);
});

test("keeps the same reference in different frameworks", async () => {
  const now = "2026-10-29T10:00:00.000Z";
  const source = {
    id: "src-ai-test",
    frameworkId: "ai-act",
    title: "Test AI Act",
    publisher: "European Union",
    version: "2024.1.0",
    kind: "html",
    license: "public",
    importedAt: now,
    lastReviewedAt: null,
  };
  const requirement = {
    id: "req-ai-test-1",
    sourceId: source.id,
    frameworkId: "ai-act",
    ref: "Art. 1",
    title: "Subject matter",
    text: "This Regulation lays down rules for AI systems.",
    theme: "organizational",
    status: "draft",
    reviewer: null,
    reviewedAt: null,
    createdAt: now,
  };

  await store.saveSource(source, [requirement]);

  const library = await fetch(`${baseUrl}/api/library`).then((response) =>
    response.json(),
  );
  const refs = library.requirements
    .filter((item) => item.ref === "Art. 1")
    .map((item) => item.frameworkId);
  assert.deepEqual(refs.sort(), ["ai-act", "nis2"]);
});

test("serves the MCP handshake and a guided assessment", async () => {
  const initialize = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    }),
  }).then((response) => response.json());
  assert.equal(initialize.result.serverInfo.name, "comply");
  assert.equal(initialize.result.capabilities.tools.listChanged, false);

  const tools = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  }).then((response) => response.json());
  const names = tools.result.tools.map((tool) => tool.name);
  assert.ok(names.includes("start_assessment"));
  assert.ok(names.includes("submit_evidence"));
  assert.ok(names.includes("export_assessment"));

  const started = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-comply-tenant": "nordwind",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "start_assessment",
        arguments: {
          framework: "nis2",
          scope: "Production systems.",
          limit: 1,
        },
      },
    }),
  }).then((response) => response.json());
  assert.equal(started.result.isError, false);
  assert.equal(started.result.structuredContent.phase, "collect");
  assert.equal(
    started.result.structuredContent.language_policy.publishLanguage,
    "en",
  );

  const assessmentId = started.result.structuredContent.assessment_id;

  const callTool = (id, name, args) =>
    fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-comply-tenant": "nordwind",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }).then((response) => response.json());

  const listed = await callTool(4, "list_assessments", { pageSize: 1 });
  assert.equal(listed.result.isError, false);
  assert.equal(listed.result.structuredContent.page_info.total_items, 1);
  assert.equal(listed.result.structuredContent.page_info.has_next_page, false);

  const checklist = await callTool(5, "list_requirements", {
    assessmentId,
    pageSize: 1,
  });
  assert.equal(checklist.result.isError, false);
  assert.equal(checklist.result.structuredContent.page_info.total_items, 1);

  const search = await callTool(6, "search_requirements", {
    assessmentId,
    query: "essential entities",
  });
  assert.equal(search.result.isError, false);
  assert.ok(search.result.structuredContent.items.length > 0);
  assert.equal(typeof search.result.structuredContent.items[0].score, "number");

  const progress = await callTool(7, "get_progress", { assessmentId });
  assert.equal(progress.result.isError, false);
  assert.equal(progress.result.structuredContent.progress.total, 1);
  assert.equal(progress.result.structuredContent.by_status.open, 1);

  const boards = await fetch(`${baseUrl}/api/agent/boards`, {
    headers: { "x-comply-tenant": "nordwind" },
  }).then((response) => response.json());
  assert.equal(boards.boards.length, 1);
  assert.equal(boards.boards[0].assessment_id, assessmentId);
  assert.equal(boards.boards[0].scope, "Production systems.");

  const board = await fetch(`${baseUrl}/api/agent/boards/${assessmentId}`, {
    headers: { "x-comply-tenant": "nordwind" },
  }).then((response) => response.json());
  assert.equal(board.assessment.items.length, 1);
  assert.equal(board.assessment.items[0].ref, "Art. 1");
  assert.match(board.assessment.items[0].description, /essential entities/);
  assert.equal(board.assessment.language_policy.publishLanguage, "en");

  const detail = await fetch(
    `${baseUrl}/api/agent/assessments/${assessmentId}`,
    { headers: { "x-comply-tenant": "nordwind" } },
  ).then((response) => response.json());
  assert.equal(detail.total, 1);
  assert.equal(detail.items[0].evidence.length, 0);
});

test("runs the email-link sign-in flow", async () => {
  const linkResponse = await fetch(`${baseUrl}/api/auth/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "adrian@comply.ro" }),
  });
  assert.equal(linkResponse.status, 201);
  const link = await linkResponse.json();
  assert.equal(link.sent, true);
  assert.ok(link.devToken);

  const verified = await fetch(`${baseUrl}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: link.devToken }),
  }).then((response) => response.json());

  assert.equal(verified.user.email, "adrian@comply.ro");

  const me = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { authorization: `Bearer ${verified.session}` },
  }).then((response) => response.json());
  assert.equal(me.user.name, "Adrian");
});

test("signs in with email and password", async () => {
  const providers = await fetch(`${baseUrl}/api/auth/providers`).then(
    (response) => response.json(),
  );
  assert.equal(providers.password, true);
  assert.deepEqual(providers.providers, []);
  assert.equal(providers.setupRequired, false);
  assert.deepEqual(providers.demo, {
    email: "adrian@comply.ro",
    password: "comply-demo",
  });

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "adrian@comply.ro",
      password: "comply-demo",
    }),
  });
  assert.equal(login.status, 200);
  const result = await login.json();
  assert.equal(result.user.organizationName, "Nordwind Logistics");
  assert.equal(result.user.role, "admin");
  assert.equal("salt" in result.user, false);
  assert.equal("hash" in result.user, false);

  const rejected = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "adrian@comply.ro", password: "wrong" }),
  });
  assert.equal(rejected.status, 401);
});

test("rejects an invalid OIDC exchange code", async () => {
  const response = await fetch(`${baseUrl}/api/auth/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "not-a-code" }),
  });
  assert.equal(response.status, 400);
});

test("requires a tenant-bound MCP key outside development", async () => {
  const directory = await mkdtemp(join(tmpdir(), "comply-prod-"));
  const store = new LibraryStore({ dataDir: join(directory, "data") });
  await store.init();
  const app = createApiServer({
    store,
    auth: createAuth({ secret: "production-test" }),
    dev: false,
    ingestSchedule: { intervalHours: 0, onStart: false },
    mcpKeysDataFile: join(directory, "data", "mcp-keys.json"),
  });
  await app.ready;
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  try {
    const key = await fetch(`${base}/api/access/keys`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-comply-tenant": "helios",
      },
      body: JSON.stringify({ name: "Helios harness", scopes: ["read"] }),
    }).then((response) => response.json());
    assert.match(key.secret, /^sk_mcp_helios_[a-f0-9]{64}$/);

    const anonymous = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    assert.equal(anonymous.status, 401);

    const forged = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer sk_mcp_helios_${"a".repeat(64)}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    assert.equal(forged.status, 401);

    const mismatch = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key.secret}`,
        "x-comply-tenant": "nordwind",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    assert.equal(mismatch.status, 403);

    const handshake = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key.secret}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    assert.equal(handshake.status, 200);

    const started = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key.secret}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "start_assessment",
          arguments: {
            framework: "nis2",
            scope: "Helios production systems.",
            limit: 1,
          },
        },
      }),
    }).then((response) => response.json());
    assert.equal(started.result.isError, false);

    const helios = await fetch(`${base}/api/agent/assessments`, {
      headers: { "x-comply-tenant": "helios" },
    }).then((response) => response.json());
    const nordwind = await fetch(`${base}/api/agent/assessments`, {
      headers: { "x-comply-tenant": "nordwind" },
    }).then((response) => response.json());
    assert.equal(helios.assessments.length, 1);
    assert.equal(nordwind.assessments.length, 0);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects an invalid email address", async () => {
  const response = await fetch(`${baseUrl}/api/auth/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "not-an-email" }),
  });
  assert.equal(response.status, 400);
});
