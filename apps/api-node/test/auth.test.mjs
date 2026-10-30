import assert from "node:assert/strict";
import { generateKeyPairSync, sign as signValue } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAuth } from "../lib/auth.mjs";
import { createOidc, oidcProviders } from "../lib/oidc.mjs";
import { UserRegistry } from "../lib/users.mjs";

async function temporaryRegistry() {
  const directory = await mkdtemp(join(tmpdir(), "comply-users-"));
  const dataFile = join(directory, "users.json");
  const users = new UserRegistry({
    dataFile,
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
  return {
    users,
    dataFile,
    async cleanup() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("registers a local account and verifies the password", async () => {
  const { users, cleanup } = await temporaryRegistry();
  try {
    const user = await users.create({
      email: "ops@example.com",
      name: "Ops",
      password: "a-long-password",
    });
    assert.equal(user.email, "ops@example.com");
    assert.equal(
      (await users.authenticate("ops@example.com", "a-long-password")).name,
      "Ops",
    );
    assert.equal(
      await users.authenticate("ops@example.com", "wrong-password"),
      null,
    );
    await assert.rejects(
      users.create({
        email: "ops@example.com",
        password: "another-long-password",
      }),
      /already exists/,
    );
    await assert.rejects(
      users.create({ email: "short@example.com", password: "short" }),
      /at least 10/,
    );
  } finally {
    await cleanup();
  }
});

test("makes the first account an administrator and later accounts members", async () => {
  const directory = await mkdtemp(join(tmpdir(), "comply-first-user-"));
  const users = new UserRegistry({ dataFile: join(directory, "users.json") });
  await users.init();
  try {
    const first = await users.create({
      email: "owner@example.com",
      name: "Owner",
      password: "a-long-password",
      organizationName: "Acme",
    });
    assert.equal(first.role, "admin");

    const second = await users.create({
      email: "member@example.com",
      name: "Member",
      password: "another-long-password",
    });
    assert.equal(second.role, "member");

    const external = await users.ensureExternal({
      email: "sso@example.com",
      provider: "google",
    });
    assert.equal(external.role, "member");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("issues a session for a seeded password account", async () => {
  const { users, cleanup } = await temporaryRegistry();
  try {
    const auth = createAuth({ secret: "test-secret", users });
    const result = await auth.login("adrian@comply.ro", "comply-demo");
    assert.equal(result.user.organizationName, "Nordwind Logistics");
    assert.equal(result.user.role, "admin");
    assert.equal(auth.session(result.session).email, "adrian@comply.ro");

    await assert.rejects(auth.login("adrian@comply.ro", "nope"), (error) => {
      assert.equal(error.status, 401);
      return true;
    });
  } finally {
    await cleanup();
  }
});

test("configures providers only when a client id and secret exist", () => {
  const providers = oidcProviders({
    COMPLY_OIDC_GOOGLE_CLIENT_ID: "google-id",
    COMPLY_OIDC_GOOGLE_CLIENT_SECRET: "google-secret",
    COMPLY_OIDC_GITHUB_CLIENT_ID: "github-id",
  });
  assert.deepEqual(
    providers.map((provider) => provider.id),
    ["google"],
  );
});

test("completes an OIDC sign-in with a signed identity token", async () => {
  const { users, cleanup } = await temporaryRegistry();
  try {
    const auth = createAuth({ secret: "oidc-secret", users });
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const jwk = {
      ...publicKey.export({ format: "jwk" }),
      kid: "test-key",
      alg: "RS256",
    };
    const origin = "http://localhost:4200";
    const provider = {
      id: "test",
      label: "Test",
      kind: "oidc",
      issuer: "https://issuer.test",
      authorizationEndpoint: "https://issuer.test/authorize",
      tokenEndpoint: "https://issuer.test/token",
      jwksUri: "https://issuer.test/jwks",
      clientId: "client-id",
      clientSecret: "client-secret",
      scopes: ["openid", "email"],
    };

    let idToken = "";
    const oidc = createOidc({
      providers: [provider],
      auth,
      users,
      fetchImpl: async (url) => {
        if (String(url) === provider.tokenEndpoint) {
          return Response.json({ access_token: "access", id_token: idToken });
        }
        if (String(url) === provider.jwksUri) {
          return Response.json({ keys: [jwk] });
        }
        throw new Error(`Unexpected fetch ${url}`);
      },
    });

    const start = new URL(oidc.begin("test", origin));
    const state = start.searchParams.get("state");
    assert.equal(start.searchParams.get("code_challenge_method"), "S256");
    assert.equal(
      start.searchParams.get("redirect_uri"),
      `${origin}/api/auth/oidc/test/callback`,
    );

    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", kid: "test-key" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: provider.issuer,
        aud: provider.clientId,
        exp: Math.floor(Date.now() / 1000) + 300,
        nonce: start.searchParams.get("nonce"),
        email: "oidc@example.com",
        name: "OIDC User",
      }),
    ).toString("base64url");
    const signature = signValue(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      privateKey,
    ).toString("base64url");
    idToken = `${header}.${payload}.${signature}`;

    const user = await oidc.complete("test", { code: "code", state, origin });
    assert.equal(user.email, "oidc@example.com");
    assert.equal(user.name, "OIDC User");
    assert.ok(users.find("oidc@example.com").providers.includes("test"));
  } finally {
    await cleanup();
  }
});

test("completes a GitHub OAuth sign-in with a verified email", async () => {
  const { users, cleanup } = await temporaryRegistry();
  try {
    const auth = createAuth({ secret: "github-secret", users });
    const provider = {
      id: "github",
      label: "GitHub",
      kind: "oauth2",
      authorizationEndpoint: "https://github.test/authorize",
      tokenEndpoint: "https://github.test/token",
      userEndpoint: "https://api.github.test/user",
      emailsEndpoint: "https://api.github.test/emails",
      clientId: "client-id",
      clientSecret: "client-secret",
      scopes: ["read:user", "user:email"],
    };
    const oidc = createOidc({
      providers: [provider],
      auth,
      users,
      fetchImpl: async (url) => {
        if (String(url) === provider.tokenEndpoint) {
          return Response.json({ access_token: "access" });
        }
        if (String(url) === provider.userEndpoint) {
          return Response.json({
            login: "octo",
            name: "Octo Cat",
            email: null,
          });
        }
        if (String(url) === provider.emailsEndpoint) {
          return Response.json([
            { email: "hidden@example.com", primary: false, verified: true },
            { email: "octo@example.com", primary: true, verified: true },
          ]);
        }
        throw new Error(`Unexpected fetch ${url}`);
      },
    });

    const start = new URL(oidc.begin("github", "http://localhost:4200"));
    const user = await oidc.complete("github", {
      code: "code",
      state: start.searchParams.get("state"),
      origin: "http://localhost:4200",
    });
    assert.equal(user.email, "octo@example.com");
    assert.equal(user.name, "Octo Cat");
  } finally {
    await cleanup();
  }
});
