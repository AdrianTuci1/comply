import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { McpKeyRegistry } from "../lib/keys.mjs";

test("creates a tenant-bound key and authenticates it", async () => {
  const registry = new McpKeyRegistry();
  await registry.init();

  const created = registry.create("nordwind", {
    name: "CI harness",
    scopes: ["read", "evidence:write"],
  });

  assert.match(created.secret, /^sk_mcp_nordwind_[a-f0-9]{64}$/);
  assert.equal(created.key.tenantId, "nordwind");
  assert.equal(created.key.hash, undefined);
  assert.match(created.key.prefix, /^sk_mcp_nordwind_[a-f0-9]{6}$/);

  const authenticated = registry.authenticate(created.secret);
  assert.equal(authenticated.id, created.key.id);
  assert.equal(authenticated.tenantId, "nordwind");
  assert.equal(registry.list("helios").length, 0);
});

test("rejects forged, revoked, and malformed keys", async () => {
  const registry = new McpKeyRegistry({
    secretFactory: () => "a".repeat(64),
  });
  await registry.init();
  const created = registry.create("nordwind", {
    name: "Harness",
    scopes: ["read"],
  });

  assert.equal(
    registry.authenticate(`sk_mcp_nordwind_${"b".repeat(64)}`),
    null,
  );
  assert.equal(registry.authenticate("sk_mcp_nordwind_short"), null);
  assert.equal(registry.authenticate(null), null);

  registry.revoke("nordwind", created.key.id);
  assert.equal(registry.authenticate(created.secret), null);
});

test("restores keys and revocation state after a restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "comply-keys-"));
  const dataFile = join(directory, "mcp-keys.json");

  try {
    const first = new McpKeyRegistry({ dataFile });
    await first.init();
    const created = first.create("nordwind", {
      name: "Restart harness",
      scopes: ["read"],
    });
    await first.flush();

    const second = new McpKeyRegistry({ dataFile });
    await second.init();
    assert.equal(second.authenticate(created.secret)?.tenantId, "nordwind");

    second.revoke("nordwind", created.key.id);
    await second.flush();

    const third = new McpKeyRegistry({ dataFile });
    await third.init();
    assert.equal(third.authenticate(created.secret), null);
    assert.equal(third.list("nordwind")[0].revokedAt === null, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
