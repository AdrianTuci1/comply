#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createApiServer } from "./lib/api.mjs";
import { createAuth } from "./lib/auth.mjs";
import { createBlobStore } from "./lib/blobs.mjs";
import { createOidc, oidcProviders } from "./lib/oidc.mjs";
import { LibraryStore } from "./lib/store.mjs";
import { UserRegistry, seedUsersFromEnv } from "./lib/users.mjs";

const DEFAULT_DATA_DIR = fileURLToPath(
  new URL("../../data/", import.meta.url),
);
const DEFAULT_WEB_ROOT = fileURLToPath(
  new URL("../web/dist/web/browser/", import.meta.url),
);

function defaultWebRoot() {
  const configured = process.env.COMPLY_WEB_ROOT;
  if (configured) return configured;
  return existsSync(DEFAULT_WEB_ROOT) ? DEFAULT_WEB_ROOT : null;
}

/** Builds the shared application without opening a port. Azure Functions and
 * the local server both call this so routing and auth stay identical. */
export async function createApp({
  dataDir = process.env.COMPLY_DATA_DIR ?? DEFAULT_DATA_DIR,
  webRoot = defaultWebRoot(),
} = {}) {
  const blobs = createBlobStore({
    connectionString: process.env.COMPLY_BLOB_CONNECTION_STRING,
    container: process.env.COMPLY_BLOB_CONTAINER || "comply",
    dataDir,
  });
  const store = new LibraryStore({ dataDir, blobs });
  await store.init();

  const seedUsers = seedUsersFromEnv();
  const users = new UserRegistry({
    dataFile: join(dataDir, "users.json"),
    seeds: seedUsers,
  });
  await users.init();

  const auth = createAuth({
    secret: process.env.COMPLY_AUTH_SECRET,
    users,
  });
  const oidc = createOidc({
    providers: oidcProviders(),
    auth,
    users,
  });
  const demoLogin =
    process.env.NODE_ENV !== "production" ||
    process.env.COMPLY_DEMO_LOGIN === "1"
      ? seedUsers[0]
        ? { email: seedUsers[0].email, password: seedUsers[0].password }
        : null
      : null;

  const api = createApiServer({
    store,
    auth,
    users,
    oidc,
    demoLogin,
    staticRoot: webRoot,
    agentDataFile: join(dataDir, "agents.json"),
    mcpKeysDataFile: join(dataDir, "mcp-keys.json"),
  });
  await api.ready;

  return {
    ...api,
    store,
    auth,
    users,
    blobs,
    dataDir,
    async flush() {
      await api.agents.flush();
      await api.keys.flush();
      await users.flush();
    },
  };
}

export async function startServer({
  port = Number(process.env.PORT ?? 4300),
  host = process.env.HOST ?? "127.0.0.1",
  dataDir = process.env.COMPLY_DATA_DIR ?? DEFAULT_DATA_DIR,
  webRoot = defaultWebRoot(),
} = {}) {
  const app = await createApp({ dataDir, webRoot });

  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(port, host, resolve);
  });

  const address = app.server.address();
  const actualPort =
    typeof address === "object" && address ? address.port : port;

  return {
    ...app,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    async close() {
      await new Promise((resolve, reject) => {
        app.server.close((error) => (error ? reject(error) : resolve()));
      });
      await app.flush();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer()
    .then((running) => {
      const library = running.store.snapshot();
      console.log(`Comply listening on ${running.url}`);
      console.log(
        `Content: ${library.sources.length} sources, ${library.requirements.length} requirements, ${library.documents.length} documents.`,
      );
      const stop = () => {
        running
          .close()
          .then(() => process.exit(0))
          .catch(() => process.exit(1));
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
