# Structura de fișiere

Monorepo. Aplicațiile stau sub `apps/`, infrastructura și documentația rămân la rădăcină.
Conținutul de conformitate stă în același repo până când recenzorii devin echipă separată.

```
/
├─ apps/
│  ├─ web/                         # Angular: sign-in, portal, workspace, trust center
│  ├─ api-node/                    # API Node: conținut, ingest, MCP, auth, static Angular
│  ├─ api-dotnet/                  # API principal: .NET 8 isolated Functions + PostgreSQL
│  ├─ functions-node/              # wrapper Azure Functions pentru instalarea one-container
│  └─ landing/                     # site de marketing static
├─ bin/comply.mjs                  # launcher npx pentru imaginea Docker
├─ content/                        # cerințe versionate pe framework
├─ contracts/                      # scheme JSON și contractul MCP
├─ data/                           # runtime: library, conturi, assessments, blob-uri (gitignored)
├─ deploy/
│  ├─ docker-compose.yml           # instalarea Node one-container
│  ├─ init.sh
│  └─ dotnet/                      # stack local split: PostgreSQL, Functions, Angular static
├─ docs/
│  ├─ agents/                      # specificații pentru agenți
│  ├─ adr/                         # decizii arhitecturale numerotate
│  └─ mcp-tools.md
├─ evals/                          # set de aur pentru citări
├─ infra/bicep/                    # Function App, PostgreSQL, Static Web App
├─ samples/                        # tenant demo și manifest
├─ tools/
│  ├─ content-ingest/              # extrage, validează, construiește bundle-uri
│  ├─ content-publisher/           # semnează și publică bundle-uri
│  ├─ build-functions.mjs          # package pentru Azure Functions (calea Node)
│  ├─ build-library.mjs
│  └─ dev/
├─ compose.yaml                    # un container Node (UI + API + MCP)
├─ Dockerfile                      # imaginea one-container
└─ .github/workflows/
```

## Rolul fiecărui folder

| Folder | Rol | Regulă |
| --- | --- | --- |
| `apps/web` | interfața Angular | standalone components, signals, config runtime `config.js` |
| `apps/api-node` | conținut, ingest, MCP, auth, static Angular | fără dependențe npm; Node 22+ |
| `apps/api-dotnet` | API principal, MCP, ingest, auth, PostgreSQL | .NET 8 isolated worker; fără static hosting |
| `apps/functions-node` | entry point Azure Functions pentru calea Node | refolosește `createApp()` din `api-node` |
| `apps/landing` | site static, separat de aplicație | fără build Angular |
| `contracts/` | scheme JSON, OpenAPI, unelte MCP | se schimbă înainte de cod |
| `content/` | date de conformitate | fără logică executabilă |
| `deploy/dotnet/` | stack local pentru deploy-ul split | PostgreSQL + Azurite + Functions + nginx |
| `infra/bicep/` | instalare în cloud-ul clientului | același template pentru toți |
| `evals/` | set de aur pentru citări | rulează la orice schimbare de prompt |
| `samples/` | tenant demo și manifest | folosit în fiecare demonstrație |

## Bundle de conținut

```
content/nis2/2024.1.0/
├─ framework.json        # id, versiune, effectiveFrom, sursă, licență
├─ requirements/
│  └─ nis2-art-21-2-a.json
├─ questions/
│  └─ nis2-art-21-2-a.json
├─ drafts/               # local, ignorat de git: text brut extras
└─ changelog.md
```

Drafturile se produc cu `tools/content-ingest`, trec prin revizuire umană și devin cerințe
prin `promote`. La build se generează `dist/content/<framework>/<versiune>/manifest.json`
cu hash-uri. Bundle-urile generate nu se commituiesc. Detalii în `content-pipeline.md`.

## Convenții

- Conținutul se versionează independent de aplicație, cu `effectiveFrom`.
- Fiecare assessment reține `contentVersion`.
- Secretele stau în Key Vault; în repo doar `local.settings.json.example`.
- `CODEOWNERS` pe `content/` către recenzorii de conformitate.
- Toate căile din documentație pornesc de la rădăcina repository-ului.

## Pipeline

| Workflow | Declanșator | Ce face |
| --- | --- | --- |
| `dotnet.yml` | push, PR, dispatch | build Angular, build/test .NET, imaginea Functions; deploy opțional pe Azure |
| `publish-image.yml` | push pe `main`, tag | publică imaginea one-container în GHCR |
