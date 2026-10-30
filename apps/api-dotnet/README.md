# Comply.Functions (.NET)

The Comply backend on Azure Functions: the content API served from the same
`data/library.json` shape as the Node backend, accounts (Azure Cosmos DB persistence,
password/magic-link sessions and external sign-in), the agent surface — guided assessments,
evidence, MCP keys and the `/mcp` JSON-RPC server — and the scheduled ingest pipeline. Library
writes and static hosting stay on the Node backend; Angular is served from a CDN in production.

See [AUTH.md](AUTH.md) for auth environment variables, provider callback URLs and database
setup, and [INGEST.md](INGEST.md) for the ingest pipeline.

Target framework: **.NET 8 (LTS)** with the **isolated worker** model and ASP.NET Core
integration (`ConfigureFunctionsWebApplication`). The current Functions worker packages
(`Microsoft.Azure.Functions.Worker` 2.52.0 / `Worker.Sdk` 2.1.0 /
`Worker.Extensions.Http.AspNetCore` 2.1.1) target `net8.0`, `net9.0` and newer, so .NET 8 LTS
keeps the app on the oldest supported runtime.

## Layout

```
apps/api-dotnet/
├── Comply.Functions.sln
├── Directory.Build.props                 net8.0, nullable, implicit usings
├── Dockerfile                            multi-stage build for the Functions runtime image
├── AUTH.md                               auth, session and persistence reference
├── INGEST.md                             ingest pipeline reference
├── README.md
├── src/Comply.Functions/
│   ├── Comply.Functions.csproj
│   ├── Program.cs                        host + DI, Cosmos store startup
│   ├── host.json                         host config, routePrefix = ""
│   ├── local.settings.json.example
│   ├── Agent/                            AgentService (15 tools), models, tool catalog, search
│   ├── Api/                              Content/Auth/Agent routers, tenant resolution, CORS
│   ├── Auth/                             tokens, passwords, auth service, OIDC providers
│   ├── Data/                             Cosmos store, settings, entities, user directory
│   ├── Json/JsonDefaults.cs              camelCase + relaxed UTF-8 escaping
│   ├── Models/                           library, requirement, source, document, responses
│   ├── Services/                         LibraryStore, LibraryQuery, MCP keys, framework catalog
│   └── Triggers/ContentFunctions.cs      catch-all HTTP trigger ({*path})
└── tests/Comply.Functions.Tests/         xUnit tests (no Azure or Cosmos DB required)
```

One `{*path}` HTTP trigger routes every request through `ContentApi`, which delegates
`/api/auth/*` to `AuthApi` and `/api/agent/*`, `/api/access/keys*` and `/mcp` to `AgentApi`.
`host.json` sets `extensions.http.routePrefix` to `""` so URLs stay `/healthz`, `/api/...`
instead of `/api/healthz` — the same URLs the Node container serves. The trigger is registered
through ASP.NET Core integration, so the handler receives `HttpRequest` and returns
`IActionResult`.

## Local run

Core Tools 4.x is required (`brew install azure-functions-core-tools@4`, or
`npm i -g azure-functions-core-tools@4`). `dotnet` alone is not enough: the worker process is
launched by the Functions host, and `func start` is what starts that host.

```bash
cd apps/api-dotnet/src/Comply.Functions
cp local.settings.json.example local.settings.json
func start                      # builds the project, serves on http://localhost:7071
```

`local.settings.json.example` enables auth against the Cosmos DB emulator
(`COMPLY_COSMOS_CONNECTION=AccountEndpoint=https://localhost:8081/;...`) and creates the
database and containers at startup. Start the emulator first:

```bash
docker run -d --name comply-cosmos -p 8081:8081 \
  -e AZURE_COSMOS_EMULATOR_PARTITION_COUNT=6 \
  mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:latest
```

Apple silicon needs `--platform linux/amd64`; the emulator is published for amd64 only and the
first boot takes about a minute.

To serve only the content API without a database, remove `COMPLY_COSMOS_CONNECTION` and expect
`503` from `/api/auth/*`.

`local.settings.json.example` points `COMPLY_DATA_DIR` at `../../../../data` (the repository
`data/` directory). To use another directory, set an absolute path:

```bash
COMPLY_DATA_DIR=/absolute/path/to/data func start
```

A smoke test is:

```bash
curl http://localhost:7071/healthz
curl http://localhost:7071/api/frameworks
curl "http://localhost:7071/api/library?framework=nis2&page=1&pageSize=5"
curl http://localhost:7071/api/documents
curl http://localhost:7071/api/documents/doc-nis2-2022-2555
curl http://localhost:7071/api/auth/providers
```

For the full stack (Cosmos DB emulator, Azurite, the Functions app and a static Angular host) use
`docker compose -f deploy/dotnet/compose.yaml up --build` from the repository root; see
[deploy/dotnet/README.md](../../deploy/dotnet/README.md).

If Core Tools is not installed, run the published output in the official runtime image
(this is the path used to verify this phase, see below):

```bash
cd apps/api-dotnet
docker run --rm -v "$PWD":/src -w /src mcr.microsoft.com/dotnet/sdk:8.0 \
  dotnet publish src/Comply.Functions/Comply.Functions.csproj -c Release

docker run --rm -p 7071:80 \
  -e AzureWebJobsStorage=UseDevelopmentStorage=true \
  -e FUNCTIONS_WORKER_RUNTIME=dotnet-isolated \
  -e COMPLY_DATA_DIR=/data \
  -e COMPLY_PUBLIC_URL=http://localhost:7071 \
  -e COMPLY_COSMOS_CONNECTION="AccountEndpoint=https://host.docker.internal:8081/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==" \
  -e COMPLY_COSMOS_EMULATOR=1 \
  -e COMPLY_AUTH_SECRET=local-development-secret \
  -v "$PWD/src/Comply.Functions/bin/Release/net8.0/publish:/home/site/wwwroot" \
  -v "$PWD/../../data:/data:ro" \
  mcr.microsoft.com/azure-functions/dotnet-isolated:4-dotnet-isolated8.0
```

## Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `COMPLY_DATA_DIR` | repo `data/`, or `/home/data` when `WEBSITE_SITE_NAME` is set | Directory with `library.json` and `documents/` |
| `COMPLY_SEED_DIR` | repo `apps/api-node/seed`, else `seed/` next to the assembly | Fallback content shipped with the app |
| `COMPLY_PUBLIC_URL` | request scheme + host | `publicUrl` in `GET /api/runtime`, OIDC `redirect_uri` base |
| `COMPLY_DEPLOYMENT_MODE` | `self_hosted` when `COMPLY_TRUST_HOST` is set, else `managed` | `deployment` in `GET /api/runtime` |
| `COMPLY_TRUST_HOST`, `COMPLY_TRUST_SLUG` | unset | `trust` block in `GET /api/runtime` |
| `COMPLY_COSMOS_CONNECTION` | unset | Cosmos DB connection string. Without it auth, agent and MCP-key routes return `503` |
| `COMPLY_COSMOS_DATABASE` | `comply` | Cosmos DB database name |
| `COMPLY_COSMOS_CREATE_CONTAINERS` | `1` | Create missing containers at startup; set `0` when infrastructure owns them |
| `COMPLY_COSMOS_EMULATOR` | detected for local endpoints | Accept the emulator's self-signed certificate |
| `COMPLY_AUTH_SECRET` | generated outside production | HMAC secret for session, magic-link and OIDC tokens; required in production |
| `COMPLY_APP_URL` | `http://localhost:4200` | Angular app URL for sign-in redirects and the production CORS allowlist. May hold a comma-separated origin list; the first value is the redirect target. |
| `COMPLY_CORS_ORIGINS` | unset | Extra CORS origins (comma-separated), added to the `COMPLY_APP_URL` list. Use it for a CDN-hosted Angular build. |
| `COMPLY_MAIL_WEBHOOK_URL` | unset | Magic-link delivery webhook |
| `COMPLY_DEV_LINKS` | `1` outside production | Return `devToken` instead of sending email |
| `COMPLY_OIDC_*` | unset | External sign-in provider configuration |

Full details, response shapes and provider callback URLs are in [AUTH.md](AUTH.md).

Load order for the library: `$COMPLY_DATA_DIR/library.json` → `$COMPLY_SEED_DIR/library.json`
→ empty library. Documents: `$COMPLY_DATA_DIR/documents/<id>.json` →
`$COMPLY_SEED_DIR/documents/<id>.json`. Missing collections are normalized and requirements
whose `sourceId` has no source are dropped, matching `normalizeLibrary()` in the Node store.
The library is read once per process and cached, like the Node server. The ingest pipeline
writes the new library and refreshes that cache, so later reads see refreshed content without a
restart.

## Agent, MCP keys and MCP server

`AgentService` is a port of `apps/api-node/lib/agent.mjs` over the `IComplyStore` abstraction
(Cosmos DB in production, an EF Core in-memory adapter in tests) and the library store.
It keeps the Node response shapes, phases (`scope`, `collect`, `review`, `export`, `complete`),
requirement statuses, revision/event recording, `next_actions`, `language_policy`, pagination
(default 25, cap 100) and the search ranking (same tokenizer, plural stemming, IDF weights and
cosine similarity). Assessment ids are `asm-` plus 8 lowercase hex characters, evidence ids are
`ev-` plus 8, and evidence/export hashes use the same SHA-256 composition as Node. A replay of
the Node agent and this service over one fixture produced identical responses for every tool
(the only value difference is the documented derived item `contentStatus`) and the same export
digest (`65cb0731c4162c15101b932155f6f215d1db893e40f7d98f70f1c8ce3453b89d`), which
`AgentServiceTests` pins.

### HTTP endpoints

| Route | Response |
| --- | --- |
| `GET /api/agent/assessments` | `{assessments: [summary...]}` newest update first. Optional `page`/`pageSize` add `total`, `page`, `pageSize`, `page_info` |
| `GET /api/agent/boards` | `{boards: [summary...]}`, same paging |
| `GET /api/agent/boards/{id}` | `{assessment: detail}` with `items[].sourceId/theme/contentStatus/evidence` and `total` |
| `GET /api/agent/assessments/{id}` | the same detail object, unwrapped |
| `GET /api/access/keys` | `{keys: [publicKey...]}` newest first |
| `POST /api/access/keys` | `201 {key, secret}`; `400` for a missing name or invalid scopes |
| `DELETE /api/access/keys/{id}` | `204`; `404 {"error":"The key was not found."}` for an unknown or other-tenant key. Idempotent |
| `POST /mcp` | JSON-RPC 2.0 (`initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `prompts/list`); `notifications/*` returns `204` with no body |
| `GET /mcp` | `405 {"error":"Use POST with a JSON-RPC request."}` with `Allow: POST` |
| `OPTIONS *` | `204` with CORS headers |

Agent errors keep the Node codes (`invalid_framework`, `empty_library`, `scope_required`,
`not_found`, `already_complete`, `evidence_required`, `review_required`, `unknown_tool`, ...)
and return `{"error": message, "code": code}` with status 400. Malformed JSON-RPC requests
return `-32600`, unknown methods `-32601` and unknown tools `-32602`. A tool failure inside
`tools/call` is a successful JSON-RPC response with `result.isError = true` and
`result.structuredContent.error = {code, message, details?}`.

### Tenancy and auth

`TenantContext` is the single resolver for `/api/agent/*`, `/api/access/keys*` and `/mcp`:

1. A bearer token that matches an MCP key resolves to the organization that owns the key. An
   `x-comply-tenant` header that names another tenant is rejected with `403`.
2. Otherwise a session bearer (or the `comply_session` cookie) resolves to the user's
   organization. The header is ignored, so a session can never be moved across tenants.
3. Outside production (same flag as `COMPLY_DEV_LINKS`: `COMPLY_DEV_LINKS=1`, or any
   environment that is not `production`) the `x-comply-tenant` slug selects an organization,
   falling back to the first organization.
4. In production a request with no session and no key gets
   `401 {"error":"Not signed in."}`.

MCP keys use the Node format and storage:

```
sk_mcp_<tenant-slug>_<64 lowercase hex characters>
```

The SHA-256 of the full token is stored in `mcp_keys.key_hash` and looked up with an equality
match (the token never reaches a prefix scan); `mcp_keys.key_prefix` keeps the displayable
`sk_mcp_<slug>_<6 hex>` prefix. Scopes are `read`, `evidence:write` and `admin`, stored and
returned on every `publicKey`. Like the Node server, **scopes are not enforced per tool**: any
valid key can call every tool for its own tenant. `last_used_at` is written at most once per
minute. Revocation is idempotent.

The legacy/development tenant fallback is unsafe in production, which is why it is tied to the
same environment check that guards `COMPLY_DEV_LINKS`; set `COMPLY_ENV=production` (or
`NODE_ENV`/`ASPNETCORE_ENVIRONMENT`/`AZURE_FUNCTIONS_ENVIRONMENT`) in production.

### MCP tools

`contracts/mcp/tools.json` is the canonical tool metadata and is embedded in the assembly as
`Comply.Functions.Agent.tools.json`; `Agent/tools.json` is a byte copy (the Docker build context
does not include `contracts/`) and `McpToolContractTests` fails if the two files differ. It is
served unchanged by `tools/list` and `initialize`, so the tool list cannot drift from the
contract. The 15 tools:

`get_agent_guide`, `start_assessment`, `list_assessments`, `get_assessment_state`, `set_scope`,
`get_brief`, `list_requirements`, `search_requirements`, `get_progress`, `get_requirement`,
`submit_evidence`, `complete_requirement`, `mark_not_applicable`, `review_assessment`,
`export_assessment`.

`resources/list` and `prompts/list` return empty arrays, and `initialize` echoes
`protocolVersion` (default `2025-06-18`), reports `capabilities.tools.listChanged = false` and
returns the `serverInfo`/`instructions` pair from the contract.

### Local flow

```bash
docker compose -f deploy/dotnet/compose.yaml up --build -d
curl http://localhost:7071/healthz

# 1. Register (first user only) and keep the session token.
curl -s -X POST http://localhost:7071/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","name":"Ada","password":"correct horse battery","organizationName":"Nordwind"}'

# 2. Run the agent over MCP with the session token (development tenant fallback also works).
curl -s -X POST http://localhost:7071/mcp \
  -H 'content-type: application/json' -H "authorization: Bearer $SESSION" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"start_assessment","arguments":{"framework":"nis2","scope":"Production systems."}}}'

# 3. Create an MCP key and use it the way a hosted agent would.
curl -s -X POST http://localhost:7071/api/access/keys \
  -H 'content-type: application/json' -H "authorization: Bearer $SESSION" \
  -d '{"name":"CI agent","scopes":["read","evidence:write"]}'
```

The full curl walkthrough (start, submit evidence, complete, review, export, key create/list/
revoke, tenant mismatch and CORS preflight) is in [AUTH.md](AUTH.md#agent-and-mcp-walkthrough).

## Parity matrix

Verified by running the Node backend (`PORT=4300 COMPLY_INGEST_ON_START=0 node apps/api-node/server.mjs`)
and the Functions host side by side against the same `data/` directory and diffing parsed JSON:
15 request variants, 0 differences for the content endpoints. `/api/frameworks` and
`/api/documents/{id}` are additionally byte-identical to the Node response. The auth routes were
checked against the Node contracts by the xUnit suite and by exercising the compose stack; they
were not part of that side-by-side JSON diff.

| Route | Node | .NET | Notes |
| --- | --- | --- | --- |
| `GET /healthz` | yes | yes | Same body shape (`status`, `time`); the `time` value is per request, formatted like `toISOString()` |
| `GET /api/runtime` | yes | yes | `passwordLogin`, `providers` and `setupRequired` now reflect the database and provider configuration |
| `GET /api/frameworks` | yes | yes | Same registry order and counts; registry copied from `lib/ingest/index.mjs` |
| `GET /api/library` | yes | yes | `framework`, `status`, `q`, `page`, `pageSize`, no-query full library with `total`/`page`/`pageSize` |
| `GET /api/documents` | yes | yes | Same body |
| `GET /api/documents/{id}` | yes | yes | `404 {"error":"Document not found."}` |
| `OPTIONS *` | yes | yes | `204` plus the CORS headers; production uses an allowlist, not `*` |
| `POST /api/library/sources`, requirement/source review writes | yes | no | `501` |
| `/api/auth/register`, `/login`, `/magic-link`, `/verify`, `/exchange`, `/me`, `/sign-out`, `/providers` | yes | yes | Same bodies; sessions are Cosmos DB-backed and externally issued codes are one-time |
| `/api/auth/oidc/{provider}/{start,callback}` | yes | yes | Google, Microsoft Entra, GitHub and generic OIDC; callback redirects to the app |
| `/mcp` (JSON-RPC, tools, resources) | yes | yes | `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `prompts/list`; `notifications/*` = `204` |
| `/api/agent/*` (assessments, boards) | yes | yes | Same summaries/detail shapes; optional `page`/`pageSize` paging is a .NET addition |
| `/api/access/keys/*` (MCP keys) | yes | yes | Same token format, `publicKey` shape and idempotent revocation |
| `/api/ingest*` (jobs, schedule) | yes | yes | Same `{jobs}`, `{job}` and `{schedule}` envelopes; `202` for a created or reused job, `400` for an unknown framework |
| Static Angular build, `/t/{slug}` trust pages | yes | no | `501`; keep static hosting on App Service or Azure Static Web Apps |

Deliberate deviations from the Node behaviour:

- **Invalid pagination returns `400`.** The Node API silently replaces unparsable or
  out-of-range `page`/`pageSize` with defaults. This host returns
  `400 {"error":"The page query parameter must be a positive integer."}` (same for `pageSize`)
  and still caps `pageSize` at `500` and treats paging past the end as an empty page, as Node
  does.
- **Wrong method on a read route returns `405`** with `Allow: GET, OPTIONS`; Node falls through
  to a `404`.
- **CORS is an allowlist in production.** Node echoes any `Origin`; this host echoes only the
  `COMPLY_APP_URL` and `COMPLY_CORS_ORIGINS` origins (plus `http://localhost:4200` outside
  production) and sends no CORS headers to other origins. Allowed origins get
  `content-type,authorization,accept,mcp-protocol-version,mcp-session-id,x-comply-tenant`,
  `Vary: origin`, and CORS headers on error responses too. `OPTIONS` is always `204`.
- **Per-item `contentStatus` is derived, not stored.** The Node assessment row copies each
  library requirement's status at start (`published`/`draft`); this host has no per-item column
  and reports the assessment-level status (`published` only when every pooled requirement was
  published, otherwise `extracted`) for every item. Field names, positions and the rest of the
  item shape are unchanged.
- **`/mcp` without credentials in production returns `401 {"error":"Not signed in."}`**, the
  shared tenant-resolution message, where Node returns "Connect with a valid MCP API key."
  Status code and tenant rules are identical.
- **Auth responses keep the Node shapes** (`{session, expiresAt, user}`, `{user}`,
  `{password, providers, demo, setupRequired}`, `{sent, email, expiresAt, devToken?}`), but the
  account store is Cosmos DB: passwords use PBKDF2 (Node scrypt hashes must be reset), users are
  unique by email, and `providers` lists every linked method. External sign-in merges accounts by
  verified email instead of creating a second user.
- **OIDC callback failures redirect with `?error=`** exactly like Node; provider error messages
  are the same (`access_denied` becomes "Sign-in was cancelled.").
- **Unimplemented areas return `501`** with `{"error": ..., "code": "not_implemented"}` instead
  of the Node `404`/static fallthrough, so gaps are visible rather than silent.
- Non-`/api` paths (including `/`) return `501`, because no static file hosting is wired up.
  Unknown `/api/...` paths still return `404 {"error":"Not found."}` like Node.
- JSON is written with `UnsafeRelaxedJsonEscaping` and camelCase names so non-ASCII text stays
  readable UTF-8 instead of `\uXXXX` escapes. Values match Node exactly; the only byte
  difference is that objects re-serialized from typed models (library sources, requirements and
  document metadata) emit members in model order rather than the order they appear in
  `library.json`. JSON objects are unordered, so clients that parse the response see no
  difference. Unknown fields on library records round-trip through `[JsonExtensionData]`
  instead of being dropped.

## Tests

```bash
cd apps/api-dotnet
dotnet test
```

385 xUnit tests, no Azure services, Functions host or Cosmos DB required. The original 166
(phase 1) still pass unchanged. The additions cover:

- **Agent domain** (`AgentServiceTests`, `AgentSearchTests`): start/scope/brief/list/search/
  requirement/progress, evidence submission validation and hashing, completion, not-applicable,
  review, export (manifest format, citations, pinned Node digest), tenant isolation, phases and
  `next_actions`, pagination bounds, and search ranking edge cases (stopwords, plurals, accents,
  empty queries, tie-breaking).
- **MCP keys** (`McpKeyServiceTests`): token format, SHA-256 lookup, prefix, scope validation,
  name validation, idempotent revocation, cross-tenant 404, `last_used_at` throttling, and
  revoked-key rejection.
- **Tenant resolution** (`TenantContextTests`): key wins with a matching header, key/header
  conflict `403`, session wins over a conflicting header, production `401`, development header
  and first-organization fallback, unconfigured database `503`.
- **HTTP and MCP** (`AgentApiTests`, `McpApiTests`, `McpToolContractTests`): agent list/detail
  shapes, key create/list/revoke statuses, `GET /mcp` 405 with `Allow`, JSON-RPC
  `-32600/-32601/-32602`, `tools/call` success and `isError` failures, `notifications/*` `204`,
  `initialize`/`tools/list`/`resources/list`/`prompts/list`, and the embedded contract.
- **CORS** (`CorsTests`): preflight from allowed and unknown origins, comma-separated lists,
  `Vary: origin`, error responses, and `OPTIONS` `204`.
- **Cosmos documents** (`CosmosDocumentTests`): camelCase field names, the top-level `id`,
  ignored navigation properties, omitted nulls, embedded requirements/evidence/events,
  `DateOnly` round-trips, and connection-string parsing (database default, emulator detection,
  container creation, endpoint logging without the key).

The services and HTTP tests run against an EF Core InMemory adapter (`EfComplyStore`) that
implements the same `IComplyStore` contract as the Cosmos store. A live Cosmos DB integration
test is not part of `dotnet test`; the compose stack is the manual end-to-end check.

The build copies `apps/api-node/seed/**` into `bin/` and `publish/` as `seed/`, so a fresh
Function App can answer requests before `data/` exists. `COMPLY_SEED_DIR` can point elsewhere if
you ship the seed separately.

## Build and test verification

`dotnet` is not installed on the development host, so both steps run in the SDK container:

```bash
docker run --rm -v "$PWD":/src -w /src/apps/api-dotnet \
  mcr.microsoft.com/dotnet/sdk:8.0 dotnet build
docker run --rm -v "$PWD":/src -w /src/apps/api-dotnet \
  mcr.microsoft.com/dotnet/sdk:8.0 dotnet test
```

Run both from the repository root so the seed content under `apps/api-node/seed` is visible to
the build. Result: `Build succeeded. 0 Warning(s) 0 Error(s)` and `Passed! - Failed: 0, Passed:
385, Skipped: 0, Total: 385`. `dotnet publish -c Release` produces `host.json`,
`functions.metadata` (single `content` function, route `{*path}`) and the packaged `seed/`
directory.

The compose stack was also started end to end: the worker created the Cosmos database and
containers, registration returned `201`, an MCP `start_assessment` call created an assessment,
evidence was submitted and completed, review and export returned the package with the manifest
digest, an MCP key was created, listed and revoked, a conflicting `x-comply-tenant` header
returned `403`, and a CORS preflight from a CDN-style origin returned the allow headers. The
exact commands are in [AUTH.md](AUTH.md#agent-and-mcp-walkthrough).

## Deployment notes

1. Create a Linux Function App on the **.NET 8 isolated** runtime
   (`FUNCTIONS_WORKER_RUNTIME=dotnet-isolated`). `infra/bicep/main.bicep` provisions this app,
   the serverless Cosmos DB account and the Static Web App; see
   [infra/bicep/README.md](../../infra/bicep/README.md).
2. Set `COMPLY_COSMOS_CONNECTION` to the account connection string (or let the template do it)
   and `COMPLY_AUTH_SECRET`; startup fails if the secret is missing in production. Containers
   are created on first boot unless `COMPLY_COSMOS_CREATE_CONTAINERS=0`.
3. Publish and deploy. Let Core Tools build and publish from the project directory:

   ```bash
   cd src/Comply.Functions
   func azure functionapp publish <function-app-name> --dotnet-isolated
   ```

   or publish to a folder and zip-deploy it from CI:

   ```bash
   dotnet publish src/Comply.Functions/Comply.Functions.csproj -c Release -o out
   (cd out && zip -r ../comply-functions.zip .)
   az functionapp deployment source config-zip \
     -g <resource-group> -n <function-app-name> --src comply-functions.zip
   ```

4. Register `https://<api-host>/api/auth/oidc/{provider}/callback` with each provider and set
   `COMPLY_APP_URL`. See [AUTH.md](AUTH.md).
5. Set `COMPLY_DATA_DIR=/home/data` and seed the empty directory on first boot
   (`cp -r seed/. /home/data/`). The app already falls back to the packaged `seed/`, so this is
   only needed so ingest or later writes see the same content.
6. `/home/data` is per instance. Anything that must be consistent across instances belongs in
   Cosmos DB or Blob Storage, the same caveat as the Node deployment.
7. Keep the Angular build on App Service or Azure Static Web Apps. If you later put a CDN or
   Front Door in front, route `/api/*` and `/healthz` to this Function App.

Application Insights packages are intentionally not referenced; `host.json` keeps the
sampling settings so telemetry starts working once the App Insights worker packages and
`APPLICATIONINSIGHTS_CONNECTION_STRING` are added.

## Remaining gaps

- Library writes and review workflow (`POST /api/library/sources`, requirement status changes).
- Static Angular hosting and the `/t/{slug}` trust redirect.
- Blob Storage adapter (`COMPLY_BLOB_*`) used by the Node deployment.
- Import of legacy `data/users.json` scrypt hashes; existing accounts need a password reset or a
  separate migration (see [AUTH.md](AUTH.md)).
- MCP tool scope enforcement (Node records scopes but does not enforce them per tool).
