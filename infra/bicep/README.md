# Azure deployment (split hosting)

The deployment has three independent pieces:

| Piece | Resource | Serves |
| --- | --- | --- |
| API + MCP | Linux **.NET 8 isolated** Function App (`DOTNET-ISOLATED\|8.0`) | `/api/*`, `/mcp`, `/healthz` |
| State | **Azure Cosmos DB for NoSQL**, serverless, database `comply` | users, assessments, requirements, evidence, MCP keys |
| UI | **Azure Static Web App** (Free or Standard) | the Angular build only |

The Static Web App is not linked to the Function App. The browser loads the bundle from the
static host and calls the Function App cross-origin; `config.js` holds the API origin and
`COMPLY_APP_URL` is the CORS allowlist. Nothing is proxied, so the Angular deployment is
cacheable and can move to a CDN or another static host without touching the API.

`main.bicep` creates:

- a `Standard_LRS` storage account (Functions host state) with a private `comply` blob container;
- a `Y1` Linux consumption plan and the Function App on the .NET 8 isolated worker;
- a serverless Cosmos DB account with the `comply` database and six containers:
  `organizations` and `users` partitioned by `/id`, `email_locks` and `external_logins`
  partitioned by `/id`, and `assessments` and `mcp_keys` partitioned by `/organizationId`;
- a Static Web App with an empty site, ready for `swa deploy`.

All names are deterministic: `uniqueString(resourceGroup().id)` is appended to `appName`.

## Prerequisites

- Azure CLI 2.50+ with the Bicep CLI (`az bicep install`); `az bicep version` must succeed.
- Contributor on the resource group: the template reads the storage account keys
  (`listKeys`) to build `AzureWebJobsStorage` and `COMPLY_BLOB_CONNECTION_STRING`, and the
  Cosmos DB connection string (`listConnectionStrings`).
- An existing resource group in a region that offers Cosmos DB serverless.
- The `Microsoft.Web` and `Microsoft.DocumentDB` providers registered in the subscription
  (`az provider register -n Microsoft.DocumentDB`).
- The Static Web App **Free** SKU is only available in a few regions. The default
  `staticSiteLocation` is `westeurope`; use `Standard` if the site must live elsewhere.
- A session secret: `openssl rand -hex 32`.

## Deploy

```bash
az group create -n comply-rg -l westeurope

az deployment group create -g comply-rg -f infra/bicep/main.bicep \
  -p authSecret="$COMPLY_AUTH_SECRET"
```

All parameters with their defaults:

| Parameter | Default | Purpose |
| --- | --- | --- |
| `appName` | `comply` | Prefix for every resource name (3–11 characters) |
| `location` | resource group location | Function App, storage account, Cosmos DB |
| `publicUrl` | Static Web App URL | Public Angular origin: sign-in redirects and the CORS allowlist |
| `apiUrl` | `https://<function-app>.azurewebsites.net` | Public API origin used for OIDC `redirect_uri` |
| `authSecret` | — (required, secure) | HMAC key for sessions, magic links and OIDC state |
| `cosmosDatabaseName` | `comply` | Cosmos DB database name |
| `staticSiteLocation` | `westeurope` | Static Web App region |
| `staticSiteSku` | `Free` | `Free` or `Standard` |
| `oidcGoogleClientId` / `...Secret` | empty | Google sign-in |
| `oidcMicrosoftClientId` / `...Secret` | empty | Microsoft Entra ID sign-in |
| `oidcMicrosoftTenant` | `common` | Entra tenant: `common`, `organizations`, `consumers`, tenant id |
| `oidcGithubClientId` / `...Secret` | empty | GitHub sign-in |
| `mailWebhookUrl` | empty | Magic-link delivery webhook |

A parameter file keeps the secrets out of your shell history:

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "authSecret": { "value": "<openssl rand -hex 32>" },
    "publicUrl": { "value": "https://comply.example.com" },
    "oidcMicrosoftClientId": { "value": "<client id>" },
    "oidcMicrosoftClientSecret": { "value": "<client secret>" },
    "oidcMicrosoftTenant": { "value": "<tenant id>" }
  }
}
```

```bash
az deployment group create -g comply-rg -f infra/bicep/main.bicep \
  -p @infra/bicep/env/prod.parameters.json
```

Set `COMPLY_AUTH_SECRET` in the shell before the inline `-p` variant, or use the parameter
file. Never commit a parameter file that contains it; `infra/bicep/env/` is for local,
git-ignored files.

The outputs are printed at the end of the deployment:

```bash
az deployment group show -g comply-rg -n main \
  --query properties.outputs -o json

# functionAppName, functionUrl, apiUrl, staticSiteName, staticSiteUrl,
# cosmosAccountName, cosmosEndpoint, cosmosDatabase, blobEndpoint, blobContainer
```

## Deploy the API

`WEBSITE_RUN_FROM_PACKAGE=1` means the Function App runs a zip package. Build it with the SDK
container (no local SDK required) and upload it:

```bash
cd apps/api-dotnet
docker run --rm -v "$PWD/../..":/src -w /src/apps/api-dotnet \
  mcr.microsoft.com/dotnet/sdk:8.0 \
  dotnet publish src/Comply.Functions/Comply.Functions.csproj -c Release -o out

(cd out && zip -r ../comply-functions.zip .)

az functionapp deployment source config-zip -g comply-rg -n <function-app-name> \
  --src comply-functions.zip
```

`func azure functionapp publish <function-app-name> --dotnet-isolated` from
`apps/api-dotnet/src/Comply.Functions` works as well.

The worker creates missing containers at startup unless `COMPLY_COSMOS_CREATE_CONTAINERS=0`.
This template provisions the database and containers itself and sets the flag to `0`, so the
first request does not depend on metadata write access. **Cosmos DB must be reachable when the
Function App starts.** If the account is still provisioning or the connection string is wrong,
startup fails and every request returns `503` until the app is restarted. Re-check the logs with
`az webapp log tail -g comply-rg -n <function-app-name>` when `/healthz` does not answer.

## Deploy the Angular build

`config.js` must point at the Function App before upload. `/api` is not proxied by the static
host, so an empty `apiBase` would send requests to the Static Web App origin.

```bash
cd apps/web
npm ci
npm run build                       # outputs dist/web/browser

cat > dist/web/browser/config.js <<'EOF'
globalThis.COMPLY_CONFIG = { apiBase: 'https://<function-app>.azurewebsites.net' };
EOF
```

Upload with the Static Web Apps CLI (the deployment token is on the Static Web App resource):

```bash
npm install -g @azure/static-web-apps-cli

az staticwebapp secrets list -g comply-rg -n <static-site-name> \
  --query properties.apiKey -o tsv

swa deploy ./dist/web/browser \
  --deployment-token <token> \
  --env production
```

The GitHub action is equivalent and is what `.github/workflows/dotnet.yml` uses when the
optional deploy job is enabled:

```yaml
- uses: Azure/static-web-apps-deploy@v1
  with:
    azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
    action: upload
    app_location: apps/web
    output_location: dist/web/browser
```

Because the Static Web App is not linked to the API, `/api` on the static host returns `404`.
That is expected: the browser talks to `apiBase` directly. If a custom domain is added in front
of the Static Web App, set `COMPLY_APP_URL` (CORS allowlist and sign-in redirect target) to that
origin and redeploy the app settings; the .NET worker has no `COMPLY_CORS_ORIGINS` setting and
uses `COMPLY_APP_URL` as the allowlist.

## Register OIDC callback URLs

Register these on each provider. The host is the API host (`functionUrl` output), not the
Static Web App:

```
https://<function-app>.azurewebsites.net/api/auth/oidc/google/callback
https://<function-app>.azurewebsites.net/api/auth/oidc/microsoft/callback
https://<function-app>.azurewebsites.net/api/auth/oidc/github/callback
https://<function-app>.azurewebsites.net/api/auth/oidc/<COMPLY_OIDC_ID>/callback
```

A custom `apiUrl` must be the same host that the providers have registered, including the
scheme; `COMPLY_PUBLIC_URL` builds the `redirect_uri` from it.

## Post-deploy checks

```bash
curl -fsS https://<function-app>.azurewebsites.net/healthz
curl -fsS https://<function-app>.azurewebsites.net/api/frameworks
curl -fsS https://<function-app>.azurewebsites.net/api/auth/providers

curl -fsS https://<static-site>.azurewebsites.net/
curl -fsS https://<static-site>.azurewebsites.net/config.js

curl -i -X OPTIONS https://<function-app>.azurewebsites.net/api/auth/providers \
  -H 'Origin: https://<static-site>.azurewebsites.net' \
  -H 'Access-Control-Request-Method: GET'
```

The preflight must echo the origin; if it does not, `COMPLY_APP_URL` does not match the Angular
origin exactly.

## Notes and limits

- The Functions host storage account is separate from Cosmos DB: the host needs it for its own
  state even though every trigger is HTTP.
- `COMPLY_DATA_DIR=/home/data` is per instance. Content comes from the packaged
  `COMPLY_SEED_DIR=/home/site/wwwroot/seed`. Anything that must survive a scale-out belongs in
  Cosmos DB or the blob container.
- The `comply` blob container is private (`publicAccess: None`). The .NET worker does not read
  the blob settings yet; they are set for parity with the Node deployment.
- Cosmos DB serverless has no provisioned throughput and keeps continuous backups managed by
  Azure. The account allows public network access; restrict it with `ipRules` or a private
  endpoint if your policy requires it.
