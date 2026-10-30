# Local split stack (.NET API + Cosmos DB + static Angular)

This stack runs the production split-hosting model on one machine:

| Container | Image | Serves |
| --- | --- | --- |
| `functions` | `apps/api-dotnet/Dockerfile` | API, MCP, `/healthz` on `:7071` |
| `cosmos` | `mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator` | users, assessments, evidence, MCP keys |
| `azurite` | `mcr.microsoft.com/azure-storage/azurite` | Functions host storage (private network only) |
| `web` | `deploy/dotnet/web.Dockerfile` | the Angular build on `:8080`, no `/api` proxy |

The Angular container is a static host. It does not proxy API calls: the bundle reads
`globalThis.COMPLY_CONFIG.apiBase` from `config.js` and calls the Function App cross-origin, which
is exactly what the Azure Static Web App deployment does. This makes the local stack a faithful
test of CORS, OIDC redirects and deep links.

```
deploy/dotnet/
├── compose.yaml                    Cosmos DB emulator + Azurite + Functions + Angular
├── web.Dockerfile                  multi-stage node build → nginx
├── nginx.conf                      SPA fallback, config.js no-cache, immutable assets
├── nginx-headers.conf              security headers shared by every location
├── docker-entrypoint-config.sh     writes config.js from COMPLY_API_BASE at start
└── .env.example                    secrets and OIDC placeholders
```

## Run

Docker Engine with Compose v2 is the only prerequisite.

```bash
cp deploy/dotnet/.env.example deploy/dotnet/.env
# set COMPLY_AUTH_SECRET in .env: openssl rand -hex 32

docker compose -f deploy/dotnet/compose.yaml up --build
```

- Angular: <http://localhost:8080>
- API: <http://localhost:7071>
- MCP: `http://localhost:7071/mcp`
- Cosmos DB emulator: <https://localhost:8081/_explorer/index.html> (self-signed certificate; the
  worker skips validation for local endpoints)

The first request to the Angular app is `/sign-in`; a fresh database has no accounts, so the
page offers the setup form. The API equivalent:

```bash
curl -X POST http://localhost:7071/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","name":"Ada","password":"correct horse battery","organizationName":"Nordwind"}'
```

Smoke test:

```bash
curl -fsS http://localhost:7071/healthz
curl -fsS http://localhost:7071/api/frameworks | head -c 200
curl -fsS http://localhost:7071/api/auth/providers
curl -fsS http://localhost:8080/config.js
curl -fsS http://localhost:8080/workspace/boards | head -c 200   # index.html via SPA fallback
```

Stop and remove the volumes (Cosmos emulator and Azurite state):

```bash
docker compose -f deploy/dotnet/compose.yaml down -v
```

The Functions runtime image and the Cosmos DB emulator are `linux/amd64` only, so
`compose.yaml` pins `platform: linux/amd64`; on Apple silicon they run under emulation and the
first build is slow.
The repository `data/` directory is mounted at `/data` and supplies `library.json` and
captured documents; the mount is writable because ingest updates the library.
`COMPLY_SEED_DIR` points at the read-only seed mount from `apps/api-node/seed`.

## Environment

Compose reads `deploy/dotnet/.env` automatically. Every value has a development default except
the OIDC credentials.

| Variable | Default in compose | Purpose |
| --- | --- | --- |
| `COMPLY_AUTH_SECRET` | development secret | HMAC key for sessions, magic links and OIDC state |
| `COMPLY_API_BASE` | `http://localhost:7071` | API origin written into the Angular `config.js` |
| `WEB_PORT` | `8080` | Public port of the Angular container; also used for the default `COMPLY_APP_URL` and `COMPLY_CORS_ORIGINS` |
| `COMPLY_APP_URL` | `http://localhost:${WEB_PORT}` | Angular origin: sign-in redirects and CORS allowlist |
| `COMPLY_PUBLIC_URL` | `http://localhost:7071` | API origin used to build OIDC `redirect_uri` values |
| `COMPLY_CORS_ORIGINS` | `http://localhost:${WEB_PORT}` | Explicit CORS allowlist, merged with `COMPLY_APP_URL` |
| `COMPLY_COSMOS_CONNECTION` | emulator connection string | Cosmos DB connection string; set it in `.env` to use a real account |
| `COMPLY_COSMOS_DATABASE` | `comply` | Database name |
| `COMPLY_COSMOS_CREATE_CONTAINERS` | `1` | Create missing containers at worker startup |
| `COMPLY_COSMOS_EMULATOR` | `1` | Accept the emulator's self-signed certificate; detected automatically for local endpoints |
| `COMPLY_DEV_LINKS` | `1` | Return `devToken` from magic-link instead of sending email |
| `COMPLY_DATA_DIR` | `/data` (read-write mount) | Content library and documents; ingest writes here |
| `COMPLY_SEED_DIR` | `/seed` | Read-only seed mount from `apps/api-node/seed` |
| `COMPLY_OIDC_*_CLIENT_ID` / `..._SECRET` | empty | Google, Microsoft, GitHub sign-in |
| `COMPLY_OIDC_MICROSOFT_TENANT` | `common` | Entra tenant |

`COMPLY_BLOB_CONNECTION_STRING` and `COMPLY_BLOB_CONTAINER` point at Azurite for parity with the
Azure app settings; the .NET worker does not read them yet.

The worker creates the `comply` database and its containers on first start when they are
missing. If Cosmos DB is not reachable the worker exits; the compose health check and
`depends_on: service_healthy` normally prevent that. The emulator takes a minute to become
ready on the first boot. Use `docker compose -f deploy/dotnet/compose.yaml logs functions` for
startup errors — the log line contains the endpoint and database name, never the account key.

## OIDC callback URLs

Register these with each provider. The host is the API, not the Angular app:

```
http://localhost:7071/api/auth/oidc/google/callback
http://localhost:7071/api/auth/oidc/microsoft/callback
http://localhost:7071/api/auth/oidc/github/callback
http://localhost:7071/api/auth/oidc/<COMPLY_OIDC_ID>/callback
```

In Azure they become `https://<function-app>.azurewebsites.net/api/auth/oidc/...`; the
`COMPLY_PUBLIC_URL` app setting (or `COMPLY_PUBLIC_URL` here) must match the registered host byte
for byte. The callback redirects back to `COMPLY_APP_URL` (`http://localhost:8080/sign-in?code=...`
locally, the Static Web App origin in Azure).

## Split-hosting notes

- **`config.js` is the only deployment-specific file in the Angular output.** The nginx
  entrypoint rewrites it at container start; on Azure it is edited after `npm run build` before
  the upload to the Static Web App. It is served with `Cache-Control: no-cache` so a changed API
  origin is picked up immediately.
- **Hashed bundles are immutable.** `nginx.conf` serves `*.js`, `*.css`, fonts and images with a
  one-year immutable cache; `index.html` and unknown routes are revalidated and fall back to
  `/index.html`, which keeps deep links such as `/workspace/boards` working on a CDN.
- **No `/api` or `/mcp` proxy.** Those paths belong to the Function App. The local stack points
  them at `:7071` through `apiBase`, so a proxy misconfiguration cannot hide behind nginx.
- **CORS is an allowlist.** The worker echoes only `COMPLY_APP_URL` (plus `localhost:4200` outside
  production). Preflight from the Angular origin must return `Access-Control-Allow-Origin`.
- **The Static Web App is never linked to the Function App.** Linking would enable the SWA
  `/api` proxy and same-origin assumptions; the deployment keeps the two hosts independent.

## Azure

`infra/bicep/main.bicep` creates the Function App, Cosmos DB account, storage account
and Static Web App. See [../../infra/bicep/README.md](../../infra/bicep/README.md) for parameters,
deployment commands and post-deploy steps. The optional deploy job in
`.github/workflows/dotnet.yml` performs the same publish and upload from CI.
