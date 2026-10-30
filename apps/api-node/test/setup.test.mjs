import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApiServer } from "../lib/api.mjs";
import { createAuth } from "../lib/auth.mjs";
import { LibraryStore } from "../lib/store.mjs";
import { UserRegistry } from "../lib/users.mjs";

test("the first account created through the API becomes the administrator", async () => {
  const directory = await mkdtemp(join(tmpdir(), "comply-setup-"));
  const store = new LibraryStore({ dataDir: join(directory, "data") });
  await store.init();
  const users = new UserRegistry({
    dataFile: join(directory, "data", "users.json"),
  });
  await users.init();
  const auth = createAuth({ secret: "setup-secret", users });
  const app = createApiServer({
    store,
    auth,
    users,
    ingestSchedule: { intervalHours: 0, onStart: false },
  });
  await app.ready;

  try {
    const first = await app.handle({
      method: "GET",
      url: "/api/auth/providers",
      headers: { host: "localhost" },
    });
    assert.equal(JSON.parse(first.body).setupRequired, true);

    const created = await app.handle({
      method: "POST",
      url: "/api/auth/register",
      headers: { host: "localhost", "content-type": "application/json" },
      bodyText: JSON.stringify({
        email: "owner@example.com",
        password: "a-long-password",
        name: "Owner",
        organizationName: "Acme",
      }),
    });
    assert.equal(created.status, 201);
    const session = JSON.parse(created.body);
    assert.equal(session.user.email, "owner@example.com");
    assert.equal(session.user.role, "admin");
    assert.equal(session.user.organizationName, "Acme");

    const after = await app.handle({
      method: "GET",
      url: "/api/auth/providers",
      headers: { host: "localhost" },
    });
    assert.equal(JSON.parse(after.body).setupRequired, false);

    const second = await app.handle({
      method: "POST",
      url: "/api/auth/register",
      headers: { host: "localhost", "content-type": "application/json" },
      bodyText: JSON.stringify({
        email: "second@example.com",
        password: "another-long-password",
        name: "Second",
        organizationName: "Acme",
      }),
    });
    assert.equal(second.status, 403);

    const login = await app.handle({
      method: "POST",
      url: "/api/auth/login",
      headers: { host: "localhost", "content-type": "application/json" },
      bodyText: JSON.stringify({
        email: "owner@example.com",
        password: "a-long-password",
      }),
    });
    assert.equal(login.status, 200);
    assert.equal(JSON.parse(login.body).user.role, "admin");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
