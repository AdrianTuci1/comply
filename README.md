# Comply

Multi-tenant evidence portal for NIS2, ISO/IEC 27001, and the EU AI Act. The customer
runs the agent inside their own infrastructure. Comply holds the content library, the
assessment state machine, and the audit package. The product does not certify anything.

## What it does

- **Managed requirements.** NIS2, ISO/IEC 27001, and EU AI Act checklists are refreshed
  from the official texts. Customers read them and cannot edit the source material.
- **Assessment boards.** Every requirement keeps its article reference and description.
  Teams record conclusions, evidence, and review status on one board.
- **Guided agent over MCP.** The customer connects any MCP client with a tenant-bound key.
  The API returns the next action at every step, from scope to export.
- **Public trust center.** Approved claims become a public page at `/t/<slug>`, with an
  uploaded header image and an optional custom domain.
- **One container.** The Angular interface, API, MCP endpoint, and trust page share one
  process, one port, and one data directory.

## Under the hood

- **Angular 22** standalone components, signals, and lazy routes for the portal and trust
  center.
- **Node 24** host with no runtime npm dependencies. It serves the static build, `/api`,
  `/mcp`, and `/healthz` from one process.
- **MCP Streamable HTTP** implemented directly over JSON-RPC 2.0, with tenant-bound keys.
- **Azure Functions** entry point that wraps the same request handler; Blob Storage backs
  documents and the content library when configured.

## Compatibility

| Component         | Version                                           |
| ----------------- | ------------------------------------------------- |
| Docker            | Engine 24+ with Compose v2                        |
| Python installer  | 3.8+                                              |
| Node, from source | 22+                                               |
| Browsers          | Current Chrome, Edge, Firefox, and Safari         |
| Azure Functions   | Node v4 programming model, Linux Consumption plan |

## Getting Started (Production)

Comply runs inside your environment. This repository does not include a hosted service;
the production paths are Docker on your server and Azure Functions in your subscription.

### One-command install

Requirements: Docker Engine with Compose v2 and Python 3.8+.

```bash
curl -fsSLO https://raw.githubusercontent.com/comply/comply/main/easy-install.py
python3 easy-install.py deploy --sitename=comply.example.com
```

The script writes a Compose project, generates `COMPLY_AUTH_SECRET`, pulls
`ghcr.io/comply/comply:latest`, and waits for `/healthz`. It does not create an account.
Open the URL and create the first account; that account becomes the administrator.

Useful options:

```bash
python3 easy-install.py deploy \
  --sitename=comply.example.com \
  --trust-host=trust.example.com \
  --project=/opt/comply \
  --port=8080 \
  --data=data
```

| Option         | Meaning                                                  |
| -------------- | -------------------------------------------------------- |
| `--sitename`   | Public hostname; the origin for links and OIDC callbacks |
| `--trust-host` | Optional trust hostname served by the same container     |
| `--project`    | Directory for `docker-compose.yml`, `.env`, and `data/`  |
| `--port`       | Host port (default `8080`)                               |
| `--version`    | Image tag (default `latest`)                             |
| `--no-start`   | Write the files without starting Docker                  |
| `--force`      | Rotate the generated session secret                      |

For a trial without a TLS proxy, pass a full URL:
`--sitename=http://203.0.113.10:8080`.

### Docker without a checkout

```bash
mkdir comply && cd comply

curl -fsSLO https://raw.githubusercontent.com/comply/comply/main/deploy/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/comply/comply/main/deploy/init.sh
chmod +x init.sh

COMPLY_SITENAME=comply.example.com ./init.sh
```

`init.sh` writes `.env` with a random session secret, starts the container, and prints the
URL. To choose a release, set `COMPLY_IMAGE=ghcr.io/comply/comply:v0.1.0` before running
it. The repository publishes the image with
[`.github/workflows/publish-image.yml`](.github/workflows/publish-image.yml) on every push
to `main` and on version tags.

Replace `comply/comply` in the URLs and image name with your GitHub owner and repository
when you run a fork.

### Reverse proxy and TLS

Terminate TLS at Caddy, Nginx, or Traefik and forward the original `Host` header to port
`8080`. A minimal Caddy configuration for both hostnames:

```caddyfile
comply.example.com {
  reverse_proxy 127.0.0.1:8080
}

trust.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

Add `COMPLY_TRUST_HOST=trust.example.com` and `COMPLY_TRUST_SLUG=nordwind` to `.env` when
the same container should also serve the public trust page. A request to
`https://trust.example.com/` then redirects to `/t/nordwind`.

### Updating and backups

```bash
cd comply
docker compose pull
docker compose up -d
```

Accounts, assessments, MCP keys, and the content library live in `./data`. Back up that
directory; it is the only state the container needs. Uploaded blobs use the same directory
unless `COMPLY_BLOB_*` points to Azure Blob Storage.

## Structure

```
src/web/                 Angular interface (sign-in, portal, workspace, trust center)
src/server/api/          Node host: API, MCP, static Angular build, ingest, auth
azure/functions/         one catch-all Azure Function that wraps the same handler
bin/comply.mjs           npx launcher for the container image
easy-install.py          production installer, no repository checkout required
deploy/                  docker-compose.yml and init.sh for the no-clone install
content/                 versioned requirements per framework
contracts/               JSON schemas for content
tools/content-ingest/    local pipeline: document → draft → requirement → bundle
infra/bicep/             Function App, private Blob container, app settings
data/                    runtime library, accounts, assessments, blobs (git ignored)
.agents/                 specifications for agents
compose.yaml             one local container on port 8080
```

## Local start

The Node host serves the Angular build, `/api`, `/mcp`, and `/healthz` on one port.

```bash
cd src/web
npm install
npm run build

cd ../..
npm start                # http://127.0.0.1:4300
```

For interface development, run the API and `ng serve` separately; the proxy forwards
`/api` to port 4300.

```bash
cd src/server/api && npm start        # API on 4300
cd src/web && npm start               # UI on 4200
```

On first start the API uses the seed in `src/server/api/seed/`: 1,415 requirements
extracted from the official EU AI Act and NIS2 texts. Refreshes update
`data/library.json`; accounts, agent assessments, and MCP keys live in `data/` as well.
The directory is mounted in Docker, so a restart keeps them.

Quick check:

```bash
curl -fsS http://127.0.0.1:4300/healthz
curl -fsS http://127.0.0.1:4300/api/frameworks
curl -fsS http://127.0.0.1:4300/api/library -o /tmp/library.json
curl -fsS http://127.0.0.1:4300/api/ingest/schedule
```

### Automatic content refresh

The API refreshes the public documents on its own and also accepts manual runs. The
schedule is reported by `GET /api/ingest/schedule` and shown in the sources page, next
to the **Refresh now** button.

| Variable                              | Default | Meaning                                              |
| ------------------------------------- | ------- | ---------------------------------------------------- |
| `COMPLY_INGEST_INTERVAL_HOURS`        | `168`   | Time between runs. `0` disables the schedule.        |
| `COMPLY_INGEST_STARTUP_DELAY_SECONDS` | `30`    | Wait before the first run after the API starts.      |
| `COMPLY_INGEST_ON_START`              | `1`     | Run at startup; set to `0` to wait for the interval. |

The scheduler lives in the API process, so it runs while the container or server is up.
For a serverless deployment, invoke `POST /api/ingest` from a timer trigger.

```bash
curl -fsS -X POST http://127.0.0.1:4300/api/ingest \
  -H 'content-type: application/json' \
  -d '{"framework":"all"}'
```

### Docker from source

```bash
docker compose up --build -d
open http://localhost:8080
curl -fsS http://localhost:8080/healthz
```

Compose starts one container from the root `Dockerfile`. It builds the Angular app and
runs the Node host, so `/`, `/api`, and `/mcp` share an origin and a port. Runtime data is
mounted from `./data`; set `COMPLY_INGEST_INTERVAL_HOURS=0` to turn the scheduler off.

To serve the public trust page from the same container, set the trust hostname:

```bash
TRUST_HOST=trust.example.com TRUST_SLUG=nordwind docker compose up -d --build
```

Point the CNAME at the server, terminate TLS at the reverse proxy, and forward the original
`Host` header. A request to `https://trust.example.com/` then redirects to
`https://trust.example.com/t/nordwind`; the workspace stays on its own hostname.

The same image runs without Compose:

```bash
docker run --rm -p 8080:8080 \
  -e COMPLY_AUTH_SECRET=change-me \
  -v comply-data:/app/data \
  ghcr.io/comply/comply:latest
```

Or through the published launcher:

```bash
npx comply start --port 8080 --data ./comply-data
```

The launcher forwards `COMPLY_*` variables from the shell and only needs Docker.

This Compose file is the development path: it builds from source and seeds
`adrian@comply.ro` / `comply-demo` for local evaluation. A production install from the
sections above creates no account; the first account created in the browser becomes the
administrator.

## Authentication

The `/sign-in` page accepts an email and password, and shows Google, Microsoft, and GitHub
buttons when those providers are configured. The same page and API run locally, in the
container, and in Azure Functions.

A fresh installation has no accounts. `/sign-in` shows a setup form; the first account
created there becomes the `admin`, and every later account is a `member`. The production
installer never seeds an account, so the administrator chooses their own credentials on
first visit. Open the URL immediately after installing and create that account before
sharing the hostname.

For demos and automated tests, a deployment can pre-create an account:

| Variable                   | Meaning                                              |
| -------------------------- | ---------------------------------------------------- |
| `COMPLY_SEED_EMAIL`        | Seed account email                                   |
| `COMPLY_SEED_PASSWORD`     | Seed account password, at least 10 characters        |
| `COMPLY_SEED_NAME`         | Display name                                         |
| `COMPLY_SEED_ORGANIZATION` | Organization name                                    |
| `COMPLY_DEMO_LOGIN`        | `1` shows the seeded credentials on the sign-in page |
| `COMPLY_AUTH_SECRET`       | HMAC secret for sessions and OIDC state              |

In development the seed defaults to `adrian@comply.ro` / `comply-demo` and the page shows
the credentials. Keep these variables out of a production deployment; the first account
created in the browser is the administrator.

OIDC uses the authorization-code flow with PKCE, state, nonce, and a signed one-time code
back to the app. Configure providers with:

| Provider  | Client id                         | Client secret                         |
| --------- | --------------------------------- | ------------------------------------- |
| Google    | `COMPLY_OIDC_GOOGLE_CLIENT_ID`    | `COMPLY_OIDC_GOOGLE_CLIENT_SECRET`    |
| Microsoft | `COMPLY_OIDC_MICROSOFT_CLIENT_ID` | `COMPLY_OIDC_MICROSOFT_CLIENT_SECRET` |
| GitHub    | `COMPLY_OIDC_GITHUB_CLIENT_ID`    | `COMPLY_OIDC_GITHUB_CLIENT_SECRET`    |

Microsoft also reads `COMPLY_OIDC_MICROSOFT_TENANT` (default `common`). A generic OIDC
provider reads `COMPLY_OIDC_ISSUER`, `COMPLY_OIDC_AUTHORIZATION_ENDPOINT`,
`COMPLY_OIDC_TOKEN_ENDPOINT`, `COMPLY_OIDC_JWKS_URI`, and the `COMPLY_OIDC_CLIENT_*`
pair. Register the callback URLs:

```
https://<host>/api/auth/oidc/google/callback
https://<host>/api/auth/oidc/microsoft/callback
https://<host>/api/auth/oidc/github/callback
```

`COMPLY_PUBLIC_URL` fixes the origin used to build those callback URLs behind a proxy.
Email links remain available as a secondary path and use `COMPLY_MAIL_WEBHOOK_URL` in
production. Sessions are HMAC-signed and expire after 8 hours.

## Trust center hosting

The public page lives at `/t/<slug>`. Two hosting modes share the same content:

- **Managed**: the CNAME points to `edge.comply.app`. Comply's edge serves
  `https://trust.<domain>/t/<slug>`, provisions TLS, and caches the page. The customer
  does not run a container for it.
- **Self-hosted**: the same `comply` container that serves the workspace also serves the
  trust page. Point the trust hostname at your ingress, terminate TLS there, and set:

```bash
COMPLY_PUBLIC_URL=https://trust.example.com
COMPLY_TRUST_HOST=trust.example.com
COMPLY_TRUST_SLUG=nordwind
```

A request to `https://trust.example.com/` then redirects to `/t/nordwind`. The Website
page shows the matching instructions and a copyable container command for the selected
mode. `GET /api/runtime` reports the active deployment, trust host, and configured
identity providers.

## Azure Functions

`azure/functions/src/functions/comply.js` registers one catch-all HTTP trigger. It calls
the same `createApp()` and `handle()` used by the container, so static files, `/api`,
`/mcp`, auth, and the trust redirect behave identically.

```bash
cd src/web && npm run build && cd ../..
node tools/build-functions.mjs
cd dist/azure && npm install --omit=dev
func azure functionapp publish <function-app-name>
```

`infra/bicep/main.bicep` creates a Linux Consumption Function App, a private Blob
container, and the app settings. The container is never public; `COMPLY_BLOB_*` enables
the Blob adapter for the library and captured documents, and `signedUrl()` issues
short-lived read SAS links.

The Functions filesystem under `/home/data` is per instance. A multi-instance production
deployment should move users, assessments, and MCP keys to Cosmos DB or Blob state.

## Content

The pipeline downloads public documents, keeps a snapshot with SHA-256, and extracts
requirements from the structure of each act. It does not invent text and does not use a
language model for parsing.

```bash
cd src/server/api
npm run list             # sources, requirements, documents
npm run ingest -- --framework nis2
npm run ingest -- --framework ai-act
npm run ingest:seed      # regenerate the seed shipped in the repository
```

Sources:

| Framework     | Document                  | Public source                                         | License     |
| ------------- | ------------------------- | ----------------------------------------------------- | ----------- |
| EU AI Act     | Regulation (EU) 2024/1689 | `artificialintelligenceact.eu` (official text mirror) | public      |
| NIS2          | Directive (EU) 2022/2555  | `nis-2-directive.com` (official text mirror)          | public      |
| ISO/IEC 27001 | ISO/IEC 27001:2022        | document uploaded by the customer                     | proprietary |

EUR-Lex blocks automated requests with AWS WAF. Every document keeps the official EUR-Lex
link in its metadata, and requirements keep the article reference. The ISO standard text
is not distributed. The deployment operator loads it through the content pipeline and
publishes the derived checklist; customers receive it as managed content and cannot edit
it.

The local bundle pipeline remains in `tools/content-ingest/`:

```bash
cd tools/content-ingest
npm install
node cli.mjs extract --framework nis2 --source ../../content/_sources/nis2/directive.pdf
node cli.mjs promote --framework nis2 --draft nis2-art-21-2-a --reviewer "Reviewer Name"
node cli.mjs validate --all
node cli.mjs build --all
```

Licensed-source rules are in [`.agents/content-pipeline.md`](.agents/content-pipeline.md).

## Assessment boards

A board is created from the published requirement library for the selected framework.
Each checklist item keeps the reference, title, and description of its requirement, so
the board detail shows the same text as the sources page. Boards can be deactivated and
reactivated; deactivated boards stay in the list and can be shown with the
**Deactivated** filter. Export and import use the portable JSON format. Boards and their
checklist changes are stored in the browser, so a refresh keeps the work.

Assessments that an agent runs over MCP appear on the same page under **Agent boards**.
The card shows the agent phase, progress, evidence count, and open requirements. Open it
to inspect every requirement, the English conclusions, the evidence with its source and
SHA-256 hash, and the next action the agent will take. The list refreshes from the API.

## Guided agent over MCP

`/mcp` is a Streamable HTTP MCP endpoint. An agent connects with the `sk_mcp_` key from
**Settings → MCP access and API keys**, starts an assessment, and follows the
`next_actions` returned by every call. The user can speak any language; the agent replies
in that language and writes scope, evidence summaries, conclusions, and the export in
English.

```json
{
  "mcpServers": {
    "comply": {
      "type": "http",
      "url": "http://localhost:8080/mcp",
      "headers": {
        "Authorization": "Bearer sk_mcp_nordwind_<64 hex characters>"
      }
    }
  }
}
```

The key carries the tenant in its `sk_mcp_<tenant>_…` prefix. The API derives the tenant
from the key, and the same key is only valid for that tenant.

Open **Workspace → Agent guide** for the copyable connection, live progress, next action,
requirements, and evidence. The flow is `scope → collect → review → export → complete`.
Assessments are saved to `data/agents.json`, so they survive a backend restart, and each
one is also available from **Workspace → Assessment boards** with a full evidence view.
The full tool list and response contract are in [`docs/mcp-tools.md`](docs/mcp-tools.md)
and [`contracts/mcp/tools.json`](contracts/mcp/tools.json).

## API

Sources and requirements are managed by Comply. The API exposes them read-only; the
sources page and the ingest pipeline refresh them from the official publications, and no
endpoint accepts user-created sources or requirement edits.

| Method   | Route                         | Purpose                                                                                |
| -------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| `GET`    | `/api/frameworks`             | sources, requirement counts, last download                                             |
| `GET`    | `/api/library`                | managed sources + requirements; filters `framework`, `status`, `q`, `page`, `pageSize` |
| `GET`    | `/api/documents`              | captured documents                                                                     |
| `GET`    | `/api/documents/:id`          | text by article                                                                        |
| `GET`    | `/api/ingest/schedule`        | scheduler state, last result, next run                                                 |
| `POST`   | `/api/ingest`                 | start the pipeline for `nis2`, `ai-act`, or `all`                                      |
| `GET`    | `/api/ingest/:id`             | job progress                                                                           |
| `POST`   | `/mcp`                        | MCP Streamable HTTP endpoint for guided assessments                                    |
| `GET`    | `/api/agent/assessments`      | agent assessments for the tenant                                                       |
| `GET`    | `/api/agent/assessments/:id`  | requirements, evidence, progress, and next actions for one assessment                  |
| `GET`    | `/api/agent/boards`           | agent boards shown on the assessment boards page                                       |
| `GET`    | `/api/agent/boards/:id`       | one agent board with its evidence and timeline                                         |
| `GET`    | `/api/runtime`                | deployment mode, trust host, and configured providers                                  |
| `GET`    | `/api/auth/providers`         | password support, OIDC providers, demo credentials, and setup state                    |
| `POST`   | `/api/auth/register`          | create the first account; returns a session and makes it administrator                 |
| `POST`   | `/api/auth/login`             | email and password sign-in                                                             |
| `POST`   | `/api/auth/exchange`          | exchange the OIDC one-time code for a session                                          |
| `GET`    | `/api/auth/oidc/:id/start`    | redirect to the provider                                                               |
| `GET`    | `/api/auth/oidc/:id/callback` | provider callback; redirects to the app with a one-time code                           |
| `POST`   | `/api/auth/magic-link`        | create the sign-in link                                                                |
| `POST`   | `/api/auth/verify`            | exchange the link for a session                                                        |
| `GET`    | `/api/auth/me`                | current session user                                                                   |
| `GET`    | `/api/access/keys`            | MCP keys for the tenant, without secrets                                               |
| `POST`   | `/api/access/keys`            | create a tenant-bound MCP key; the secret is returned once                             |
| `DELETE` | `/api/access/keys/:id`        | revoke an MCP key                                                                      |

## Tests

```bash
cd src/server/api && npm test
cd tools/content-ingest && npm test
cd src/web && npm test
```

## Content licensing

The NIS2 and EU AI Act texts are public and redistributed with attribution. ISO/IEC 27001
uses original wording and references to control identifiers; the customer supplies the
standard text. Raw source documents and local drafts are not committed to the repository.
