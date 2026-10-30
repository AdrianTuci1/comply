# Authentication and persistence

The Functions host stores users, assessments and findings in Azure Cosmos DB for NoSQL through
the `IComplyStore` abstraction.
Accounts can sign in with a password, a magic link, or an external provider (Google, Microsoft
Entra ID, GitHub, or any OpenID Connect provider). The Angular client keeps using its Bearer
session token; an HttpOnly `comply_session` cookie is also accepted and set for same-origin
deployments. The same tokens also authorize the agent surface (`/api/agent/*`,
`/api/access/keys*`), and MCP clients use a separate `sk_mcp_...` key.

This document covers the configuration, the HTTP contracts and the local workflow. The library
content API is served from `data/library.json`; ingest runs in this host, while library writes
and static hosting stay on the Node backend.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `COMPLY_COSMOS_CONNECTION` | unset | Cosmos DB connection string. Without it, auth and agent routes return `503`. |
| `COMPLY_COSMOS_DATABASE` | `comply` | Database name. |
| `COMPLY_COSMOS_CREATE_CONTAINERS` | `1` | Create missing containers at worker startup. Set `0` when infrastructure provisions them. |
| `COMPLY_COSMOS_EMULATOR` | detected for local endpoints | Accept the emulator's self-signed certificate. |
| `COMPLY_AUTH_SECRET` | generated outside production | HMAC key for session, magic-link, OIDC code and OIDC state tokens. **Required in production**; startup fails without it. Generate with `openssl rand -hex 32`. |
| `COMPLY_APP_URL` | `http://localhost:4200` | Angular app URL. Sign-in links and OIDC callbacks redirect to the first value. Comma-separated origins are all added to the production CORS allowlist. |
| `COMPLY_CORS_ORIGINS` | unset | Extra origins (comma-separated) for the CORS allowlist, merged with `COMPLY_APP_URL`. Use it for a CDN-hosted Angular build. |
| `COMPLY_MAIL_WEBHOOK_URL` | unset | HTTP endpoint that receives `{to, url, expiresAt}` for magic links. Required unless `COMPLY_DEV_LINKS=1`. |
| `COMPLY_DEV_LINKS` | `1` outside production | Return `devToken` from `POST /api/auth/magic-link` and log the link instead of sending email. |
| `COMPLY_OIDC_GOOGLE_CLIENT_ID` / `..._SECRET` | unset | Google sign-in. Both are required to enable it. |
| `COMPLY_OIDC_MICROSOFT_CLIENT_ID` / `..._SECRET` | unset | Microsoft Entra ID (v2.0 endpoints). |
| `COMPLY_OIDC_MICROSOFT_TENANT` | `common` | Entra tenant: `common`, `organizations`, `consumers`, or a tenant id/domain. |
| `COMPLY_OIDC_GITHUB_CLIENT_ID` / `..._SECRET` | unset | GitHub OAuth2 sign-in. Requires a verified email. |
| `COMPLY_OIDC_CLIENT_ID` / `..._SECRET` | unset | Generic OIDC provider. |
| `COMPLY_OIDC_ISSUER` | unset | Generic issuer, also the base for `.well-known/openid-configuration`. |
| `COMPLY_OIDC_AUTHORIZATION_ENDPOINT` | unset | Generic authorization endpoint. |
| `COMPLY_OIDC_TOKEN_ENDPOINT` | unset | Generic token endpoint. |
| `COMPLY_OIDC_JWKS_URI` | unset | Generic signing keys, used when discovery is unavailable. |
| `COMPLY_OIDC_USERINFO_ENDPOINT` | unset | Optional generic userinfo endpoint (fallback when no ID token is returned). |
| `COMPLY_OIDC_ID` | `sso` | Provider id, used in the callback URL. |
| `COMPLY_OIDC_LABEL` | `Single sign-on` | Provider label shown by the client. |
| `COMPLY_PUBLIC_URL` | request origin | Public API origin used to build OIDC `redirect_uri` values. Set this behind a proxy. |

Production is detected from `NODE_ENV`, `ASPNETCORE_ENVIRONMENT`, `AZURE_FUNCTIONS_ENVIRONMENT`
or `COMPLY_ENV` being `production`.

## HTTP contracts

All bodies are JSON. Errors use `{"error": "..."}` with the Node status codes.

| Route | Request | Success |
| --- | --- | --- |
| `POST /api/auth/register` | `{email, name?, password, organizationName?}` | `201 {session, expiresAt, user}`. Only allowed while no users exist; otherwise `403`. |
| `POST /api/auth/login` | `{email, password}` | `200 {session, expiresAt, user}`; `401` on bad credentials. |
| `POST /api/auth/magic-link` | `{email}` | `201 {sent: true, email, expiresAt, devToken?}`; `503` when email delivery is not configured. |
| `POST /api/auth/verify` | `{token}` | `200 {session, expiresAt, user}`; `400` for invalid or expired links. |
| `POST /api/auth/exchange` | `{code}` | `200 {session, expiresAt, user}`; `400` for invalid or expired codes. |
| `GET /api/auth/me` | Bearer token or `comply_session` cookie | `200 {user}`; `401 {"error":"Not signed in."}`. |
| `POST /api/auth/sign-out` | — | `204`, clears the cookie. Sessions are stateless; delete the token client-side. |
| `GET /api/auth/providers` | — | `200 {password, providers: [{id, label, kind}], demo, setupRequired}`. |
| `GET /api/auth/oidc/{provider}/start` | — | `302` to the provider; `404` when the provider is not configured. |
| `GET /api/auth/oidc/{provider}/callback` | provider redirect | `302 {COMPLY_APP_URL}/sign-in?code=...`; failures redirect with `?error=...`. |

`user` is `{email, name, organizationName, role}` and `role` is `admin` or `member`. The first
registration creates the organization and its admin; later users join that organization as
members through external sign-in. There is no seeding and no hard-coded production account.

`expiresAt` is UTC ISO-8601 with milliseconds, for example `2026-10-30T20:00:00.000Z`.

## Agent, key and MCP contracts

These routes accept a session bearer or the `comply_session` cookie, an MCP key, or (outside
production) the `x-comply-tenant` header. See [Tenancy](#tenancy) for precedence.

| Route | Request | Success |
| --- | --- | --- |
| `GET /api/agent/assessments` | — | `200 {assessments: [summary...]}` newest update first. Optional `page`/`pageSize` add `total`, `page`, `pageSize`, `page_info` |
| `GET /api/agent/boards` | — | `200 {boards: [summary...]}`, same paging |
| `GET /api/agent/boards/{id}` | — | `200 {assessment: detail}`; `404` for another tenant |
| `GET /api/agent/assessments/{id}` | — | `200 detail` (unwrapped) |
| `GET /api/access/keys` | — | `200 {keys: [publicKey...]}` newest first |
| `POST /api/access/keys` | `{name, scopes}` | `201 {key, secret}`; `400 {"error":"The key needs a name.","code":"invalid_name"}` or `invalid_scopes` |
| `DELETE /api/access/keys/{id}` | — | `204`; `404 {"error":"The key was not found."}`; idempotent for an already-revoked key |
| `POST /mcp` | JSON-RPC 2.0 | `200` JSON-RPC response; `204` for `notifications/*` |
| `GET /mcp` | — | `405 {"error":"Use POST with a JSON-RPC request."}`, `Allow: POST` |

`publicKey` is `{id, tenantId, name, prefix, scopes, createdAt, lastUsedAt, revokedAt}` and
`secret` is shown once. Assessment and agent errors use `{"error": "...", "code": "..."}` with
status `400`; tenant failures use `401`/`403`/`503` with the message only.

JSON-RPC behaviour matches `apps/api-node/lib/api.mjs`: invalid requests return `-32600`,
unknown methods `-32601` and unknown tools `-32602`; a failing tool is a successful response
with `result.isError = true` and `result.structuredContent.error = {code, message, details?}`.
`initialize` echoes `protocolVersion` (default `2025-06-18`), returns
`capabilities.tools.listChanged = false`, the `serverInfo` block from `contracts/mcp/tools.json`
and its `instructions`. `tools/list` serves the embedded contract, `resources/list` and
`prompts/list` return empty arrays.

## Tenancy

`TenantContext` resolves the organization once per request, in this order:

1. **MCP key.** A bearer token matching `^sk_mcp_(?<tenant>[a-z0-9][a-z0-9-]{1,39})_[a-f0-9]{64}$`
   resolves to the key's organization. A non-empty `x-comply-tenant` that differs from the key's
   tenant returns `403 {"error":"The tenant header does not match the tenant in the MCP key."}`.
2. **Session.** A session bearer or `comply_session` cookie resolves to the user's organization.
   `x-comply-tenant` is ignored, so a session cannot cross tenants.
3. **Development fallback.** When the request is outside production (see below), the
   `x-comply-tenant` slug selects an organization; without a usable header the first organization
   is used.
4. **Production without credentials.** `401 {"error":"Not signed in."}`.

"Outside production" uses the same flag as `COMPLY_DEV_LINKS`: the request is a development
request when `COMPLY_DEV_LINKS=1` or no environment variable marks production. Production is
detected from `NODE_ENV`, `ASPNETCORE_ENVIRONMENT`, `AZURE_FUNCTIONS_ENVIRONMENT` or
`COMPLY_ENV` equal to `production` (case-insensitive). If Cosmos DB is not configured the
agent routes return `503 {"error":"The database is not configured for this deployment."}`.

The MCP key format is `sk_mcp_<tenant-slug>_<64 lowercase hex characters>`. `mcp_keys.keyHash`
stores the SHA-256 of the full token and lookups use an equality query on it;
`mcp_keys.keyPrefix` keeps `sk_mcp_<slug>_<6 hex>` for display. Scopes (`read`,
`evidence:write`, `admin`) are validated on creation, stored, and returned in `publicKey`, but —
like the Node server — they are **not enforced per tool**: a valid key may call every tool for
its own tenant. `last_used_at` is written at most once per minute. Revocation is idempotent and
a key from another tenant is reported as not found.

## Tokens

`base64url(JSON payload) . base64url(HMAC-SHA256(secret, body))`, the same format as
`apps/api-node/lib/auth.mjs`. The payload always has `kind` and `exp` (Unix milliseconds):

| Kind | TTL | Extra claims | Used by |
| --- | --- | --- | --- |
| `session` | 8 h | `email` | `Authorization: Bearer` and `comply_session` |
| `magic` | 15 min | `email` | `/api/auth/verify` |
| `oidc-code` | 60 s | `email` | `/api/auth/exchange` |
| `oidc-state` | 10 min | `provider`, `verifier`, `nonce` | OIDC start/callback |

Signatures are compared with `CryptographicOperations.FixedTimeEquals`. Expiry is checked before
the payload is trusted. The OIDC `state` is signed, so the callback target and PKCE verifier
never come from user input.

## Passwords

`pbkdf2-sha256$v1$<iterations>$<salt>$<key>` (base64url salt/key, 210,000 iterations, 16-byte
salt, 32-byte key). Minimum length 10. Verification is constant-time and rejects unknown scheme
or version prefixes.

The Node deployment stores scrypt hashes as `{salt, hash}` hex pairs in `data/users.json`. Those
hashes are **not** readable by this backend. Re-register the account (first user only), reset the
password through an operator action, or migrate the hashes offline; do not copy `users.json` into
`users`.

## Provider callback URLs

Register these exact redirect URIs with each provider; they must match byte for byte, including
the scheme and host:

```
Google      https://<api-host>/api/auth/oidc/google/callback
Microsoft   https://<api-host>/api/auth/oidc/microsoft/callback
GitHub      https://<api-host>/api/auth/oidc/github/callback
Generic     https://<api-host>/api/auth/oidc/<COMPLY_OIDC_ID>/callback
```

Examples:

```
https://comply-functions.azurewebsites.net/api/auth/oidc/google/callback
https://comply-functions.azurewebsites.net/api/auth/oidc/microsoft/callback
https://comply-functions.azurewebsites.net/api/auth/oidc/github/callback
https://comply-functions.azurewebsites.net/api/auth/oidc/sso/callback
```

Locally the host is `http://localhost:7071`, so the Google URI is
`http://localhost:7071/api/auth/oidc/google/callback`. Set `COMPLY_PUBLIC_URL` when the Functions
app sits behind a proxy so the `redirect_uri` matches what the provider has registered.

Provider notes:

- Google and the generic provider use the OpenID Connect code flow with PKCE (S256) and nonce.
- Microsoft uses the v2.0 endpoints. With tenant `common`, tokens carry the sign-in tenant in
  `iss`; the issuer validator accepts `https://login.microsoftonline.com/<tenant-id>/v2.0` and
  `https://sts.windows.net/<tenant-id>/`.
- GitHub is OAuth2 only. The callback reads `/user` and `/user/emails` and requires a verified
  email (primary verified first, then any verified address).
- ID tokens are validated against the provider JWKS: signature, `aud`, `iss`, `exp`, and nonce.
  Discovery uses `<issuer>/.well-known/openid-configuration`; `COMPLY_OIDC_JWKS_URI` is the
  fallback when discovery is unavailable.

## Database

Cosmos DB for NoSQL, using the serverless capacity mode in the Bicep template. Every aggregate is
one document: an assessment embeds its requirements, evidence and events, so the agent's read and
write path is one point read and one replace.

| Container | Partition key | Document id | Contents |
| --- | --- | --- | --- |
| `organizations` | `/id` | organization id | Tenant root, unique `slug`. |
| `users` | `/id` | user id | `email`, `organizationId`, `role`, nullable `passwordHash`, `providers`, login timestamps. |
| `email_locks` | `/id` | lowercased email | `userId`. Written before the user document so an email can only belong to one account. |
| `external_logins` | `/id` | SHA-256 of `provider\nsubject` | `userId`, `provider`, `subject`. |
| `assessments` | `/organizationId` | assessment id | Header plus embedded `requirements` (with `evidence`) and `events`. |
| `mcp_keys` | `/organizationId` | key id | `keyHash`, `keyPrefix`, `scopes`, last-used and revocation timestamps. |

Documents are serialized with camelCase names; nulls and navigation properties are omitted.
`DateOnly` values such as `periodFrom` are stored as `yyyy-MM-dd`, and timestamps as ISO-8601.
An unknown document id is a `404` from Cosmos and is mapped to `null` by the store.

Email uniqueness uses the `email_locks` document: a conflicting `409` becomes
`StoreConflictException`, and a failed user write deletes the lock so a retry can succeed.
External logins use a deterministic document id, so linking the same provider subject twice is
also a `409` conflict rather than a duplicate row.

At startup `CosmosComplyStore.CreateAsync` connects in gateway mode, optionally creates the
database and containers, and logs the endpoint and database name — never the account key. An
unreachable account is a startup failure with a clear message. The store uses the session
consistency level configured on the account.

## Local Docker

`deploy/dotnet/compose.yaml` runs the Cosmos DB emulator, Azurite (the Functions host needs a
storage account), the Functions app and a static Angular host:

```bash
COMPLY_AUTH_SECRET=$(openssl rand -hex 32) docker compose -f deploy/dotnet/compose.yaml up --build
curl http://localhost:7071/healthz
curl http://localhost:7071/api/auth/providers
```

The app is published to `mcr.microsoft.com/azure-functions/dotnet-isolated:4-dotnet-isolated8.0`
and listens on `http://localhost:7071`. Cosmos DB keeps its data in the `cosmos-data` volume;
the repository `data/` directory is mounted at `/data`, writable because ingest updates
`library.json`, and `apps/api-node/seed` is mounted read-only at `/seed` for the initial content.
The compose file defaults to a development auth secret and must not be reused outside local
development.

The first-run flow:

```bash
curl -X POST http://localhost:7071/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","name":"Ada","password":"correct horse battery","organizationName":"Nordwind"}'
```

`COMPLY_APP_URL` defaults to `http://localhost:4200` so the Angular dev server receives the
OIDC callback and magic-link redirects.

### Core Tools alternative

```bash
cd apps/api-dotnet/src/Comply.Functions
cp local.settings.json.example local.settings.json
docker run -d --name comply-cosmos -p 8081:8081 \
  -e AZURE_COSMOS_EMULATOR_PARTITION_COUNT=6 \
  mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:latest
func start
```

`local.settings.json.example` points at the emulator on `localhost:8081` with container creation
enabled. On Apple silicon add `--platform linux/amd64`; the emulator image is amd64 only and its
first boot takes about a minute. Core Tools also needs
`AzureWebJobsStorage=UseDevelopmentStorage=true` with Azurite running, or a real storage
connection string.

### Agent and MCP walkthrough

With the compose stack running (`docker compose -f deploy/dotnet/compose.yaml up --build -d`
from the repository root),
the development fallback allows the same calls with or without a session token. The commands
below use the session token, so they also work with `COMPLY_ENV=production`.

```bash
API=http://localhost:7071

# Register (first user only) and keep the bearer token.
SESSION=$(curl -s -X POST "$API/api/auth/register" \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","name":"Ada","password":"correct horse battery","organizationName":"Nordwind"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["session"])')

# Start an assessment through MCP.
ASSESSMENT=$(curl -s -X POST "$API/mcp" -H 'content-type: application/json' \
  -H "authorization: Bearer $SESSION" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"start_assessment","arguments":{"framework":"nis2","scope":"Production systems."}}}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["structuredContent"]["assessment_id"])')

# Submit evidence, complete the requirement, review and export.
curl -s -X POST "$API/mcp" -H 'content-type: application/json' -H "authorization: Bearer $SESSION" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"submit_evidence\",\"arguments\":{\"assessmentId\":\"$ASSESSMENT\",\"requirementId\":\"req-nis2-risk\",\"title\":\"Risk register\",\"type\":\"document\",\"source\":\"SharePoint\",\"summary\":\"The risk register is approved annually.\",\"citation\":\"https://sharepoint.example/risk\"}}}"

curl -s -X POST "$API/mcp" -H 'content-type: application/json' -H "authorization: Bearer $SESSION" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"complete_requirement\",\"arguments\":{\"assessmentId\":\"$ASSESSMENT\",\"requirementId\":\"req-nis2-risk\",\"conclusion\":\"The policy is approved.\"}}}"

curl -s -X POST "$API/mcp" -H 'content-type: application/json' -H "authorization: Bearer $SESSION" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"review_assessment\",\"arguments\":{\"assessmentId\":\"$ASSESSMENT\"}}}"

curl -s -X POST "$API/mcp" -H 'content-type: application/json' -H "authorization: Bearer $SESSION" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"export_assessment\",\"arguments\":{\"assessmentId\":\"$ASSESSMENT\"}}}"

# MCP key lifecycle.
KEY=$(curl -s -X POST "$API/api/access/keys" -H 'content-type: application/json' \
  -H "authorization: Bearer $SESSION" \
  -d '{"name":"CI agent","scopes":["read","evidence:write"]}')
SECRET=$(printf '%s' "$KEY" | python3 -c 'import json,sys; print(json.load(sys.stdin)["secret"])')
KEY_ID=$(printf '%s' "$KEY" | python3 -c 'import json,sys; print(json.load(sys.stdin)["key"]["id"])')
curl -s "$API/api/access/keys" -H "authorization: Bearer $SESSION"
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE "$API/api/access/keys/$KEY_ID" \
  -H "authorization: Bearer $SESSION"

# The key works for its own tenant; a conflicting header is rejected.
curl -s -X POST "$API/mcp" -H 'content-type: application/json' \
  -H "authorization: Bearer $SECRET" \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/list"}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/mcp" -H 'content-type: application/json' \
  -H "authorization: Bearer $SECRET" -H 'x-comply-tenant: helios' \
  -d '{"jsonrpc":"2.0","id":7,"method":"tools/list"}'

# CORS preflight from a CDN-style origin (set COMPLY_CORS_ORIGINS for production builds).
curl -s -i -X OPTIONS "$API/mcp" -H 'origin: https://cdn.example' \
  -H 'access-control-request-method: POST' \
  -H 'access-control-request-headers: content-type,authorization,mcp-protocol-version'
```

## Security notes

- Tokens, passwords, client secrets and connection strings are never logged. The dev magic-link
  log line contains only the email.
- The production CORS allowlist is the union of the comma-separated `COMPLY_APP_URL` values and
  `COMPLY_CORS_ORIGINS`; `http://localhost:4200` is added only outside production (and outside
  production any origin is accepted, as Node does). Unknown origins in production receive no CORS
  headers. Allowed origins get the full preflight header list in
  [README.md](README.md#agent-mcp-keys-and-mcp-server).
- `x-comply-tenant` never moves an authenticated session to another tenant, and an MCP key
  rejects a conflicting header with `403`. The unauthenticated header fallback exists only
  outside production.
- `state` is signed and content-addressed to the provider, so redirect targets cannot be
  influenced by query parameters. PKCE verifiers and nonces live inside the signed state.
- Session tokens are stateless. Sign-out clears the cookie and the client token; revoking all
  sessions means rotating `COMPLY_AUTH_SECRET`.
- Registration is only open while the installation has no users. There is no public user
  creation afterwards.

## Not implemented yet

Ingest, library writes, Blob Storage and the `/t/{slug}` trust pages are still on the Node
backend. These endpoints return `501 {"error": ..., "code": "not_implemented"}` so the gap is
visible instead of silently 404ing.
