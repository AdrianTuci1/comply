# Structura de fișiere

Monorepo. Conținutul de conformitate stă în același repo până când recenzorii devin echipă separată.

```
/
├─ .agents/                       # specificații pentru agenți
├─ docs/
│  ├─ architecture.md
│  ├─ adr/                        # decizii arhitecturale numerotate
│  ├─ mcp-tools.md
│  └─ content-model.md
├─ contracts/                     # interfețele dintre componente
│  ├─ openapi.yaml
│  ├─ mcp/tools.json
│  └─ content/*.schema.json
├─ src/
│  ├─ server/
│  │  ├─ api/                     # API Node: content library, pipeline, auth
│  │  ├─ Compliance.sln
│  │  ├─ Compliance.Functions/    # host: HTTP, timer, endpoint MCP
│  │  ├─ Compliance.Core/         # domeniu, reguli, aplicabilitate, prompturi
│  │  ├─ Compliance.Data/         # Cosmos, Blob, repository
│  │  ├─ Compliance.Connectors/   # Entra, Azure, GitHub
│  │  └─ Compliance.Tests/
│  └─ web/
│     ├─ angular.json
│     └─ src/app/
│        ├─ shared-kernel/        # Entity, ValueObject, Result
│        ├─ domain/               # organization, team, compliance, trust
│        ├─ application/          # stores, facade-uri, ports
│        ├─ infrastructure/       # in-memory repositories, browser adapters
│        ├─ features/             # portal, workspace, trust
│        ├─ shared/               # UI kit, i18n, formatare
│        └─ layout/
├─ content/
│  ├─ nis2/2024.1.0/
│  │  ├─ framework.json
│  │  ├─ requirements/
│  │  ├─ questions/
│  │  └─ changelog.md
│  ├─ iso27001/2022.1.0/
│  ├─ ai-act/2026.1.0/
│  └─ mappings/
│     ├─ nis2-iso27001.json
│     └─ iso27001-ai-act.json
├─ evals/
│  ├─ nis2/cases.jsonl
│  └─ runner/
├─ infra/
│  ├─ bicep/{main.bicep,modules/,env/}
│  └─ deploy/{azuredeploy.json,docker-compose.yml}
├─ samples/
│  ├─ demo-tenant/
│  └─ manifest.example.yaml
├─ tools/
│  ├─ content-ingest/             # extrage, promovează, validează, construiește
│  ├─ content-publisher/          # semnează și publică bundle-uri
│  └─ dev/
├─ compose.yaml                   # un container (UI + API + MCP) și validatorul de conținut
└─ .github/workflows/
```

## Rolul fiecărui folder

| Folder                             | Rol                                                               | Regulă                                   |
| ---------------------------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| `contracts/`                       | scheme JSON, OpenAPI, unelte MCP                                  | se schimbă înainte de cod                |
| `content/`                         | date de conformitate                                              | fără logică executabilă                  |
| `src/server/api`                   | conținut, ingest, MCP, static Angular, auth parolă/OIDC           | fără dependențe npm; rulează cu Node 22+ |
| `src/server/Compliance.Core`       | motor de aplicabilitate și mapare                                 | fără dependențe de Azure                 |
| `src/server/Compliance.Connectors` | o sursă per proiect                                               | activabile selectiv                      |
| `evals/`                           | set de aur pentru citări                                          | rulează la orice schimbare de prompt     |
| `infra/deploy/`                    | instalare în cloud-ul clientului                                  | același template pentru toți             |
| `samples/`                         | tenant demo și manifest                                           | folosit în fiecare demonstrație          |

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

- Conținutul se versionază independent de aplicație, cu `effectiveFrom`.
- Fiecare assessment reține `contentVersion`.
- Prompturile stau în `Compliance.Core/Prompts/`, cu nume și versiune.
- Secretele stau în Key Vault; în repo doar `local.settings.example.json`.
- `CODEOWNERS` pe `content/` către recenzorii de conformitate.

## Pipeline

| Workflow               | Declanșator                                  | Ce face                                                 |
| ---------------------- | -------------------------------------------- | ------------------------------------------------------- |
| `ci.yml`               | push, PR                                     | build .NET și Angular, teste, validare contracte        |
| `content-validate.yml` | PR în `content/` sau `tools/content-ingest/` | `cli.mjs validate --all`, schemă, referințe, licențiere |
| `publish-content.yml`  | tag de conținut                              | semnează, urcă în Blob, actualizează manifestul         |
| `evals.yml`            | schimbare de prompt sau model                | rulează setul de aur, compară cu baseline               |
| `deploy.yml`           | tag de aplicație                             | Bicep what-if, deploy Functions și frontend             |
