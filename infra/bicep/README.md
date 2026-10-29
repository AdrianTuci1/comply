# Azure deployment

One Function App serves the Angular build, `/api`, `/mcp`, and `/healthz`. Storage is a
private Blob container. The Function App reads and writes its data directory under
`/home/data`; for a multi-instance deployment move sessions and assessments to Cosmos DB
or Blob state.

```bash
az group create -n comply-rg -l westeurope
az deployment group create -g comply-rg -f infra/bicep/main.bicep \
  -p authSecret="$COMPLY_AUTH_SECRET" \
  -p publicUrl="https://comply.azurewebsites.net"
```

Build the deployment package:

```bash
cd src/web && npm run build && cd ../..
node tools/build-functions.mjs
cd dist/azure
npm install --omit=dev
func azure functionapp publish <function-app-name>
```

Register these callback URLs with each identity provider:

```
https://<function-app>/api/auth/oidc/google/callback
https://<function-app>/api/auth/oidc/microsoft/callback
https://<function-app>/api/auth/oidc/github/callback
```

Set the client id and secret for each provider as app settings. The providers appear on the
sign-in page only when both values exist.

Blob access stays private. The container is created with `publicAccess: None`; the API
serves captured documents through authenticated routes and can issue short-lived SAS
links when `COMPLY_BLOB_CONNECTION_STRING` is set.
