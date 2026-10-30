targetScope = 'resourceGroup'

// Split hosting: the .NET 8 isolated Functions app serves /api, /mcp and /healthz, PostgreSQL
// Flexible Server holds users, assessments, evidence and MCP keys, and the Angular build is
// uploaded to an independent Azure Static Web App. The Static Web App never proxies /api, so
// the browser calls the Function App cross-origin; COMPLY_APP_URL is the CORS allowlist.

@description('Prefix for every resource name. Keep it short and lowercase.')
@minLength(3)
@maxLength(11)
param appName string = 'comply'

@description('Azure region for the Function App, storage account and PostgreSQL server.')
param location string = resourceGroup().location

@description('Public origin of the Angular build (the CDN or Static Web App URL). Leave empty to use the Static Web App hostname created here.')
param publicUrl string = ''

@description('Public origin of the API (custom domain in front of the Function App). Leave empty to use the Function App hostname.')
param apiUrl string = ''

@description('HMAC secret for sessions, magic links and OIDC state. Generate with: openssl rand -hex 32')
@secure()
param authSecret string

@description('PostgreSQL administrator login. Avoid reserved names such as admin, administrator or root.')
@minLength(1)
param postgresAdminLogin string = 'complyadmin'

@description('PostgreSQL administrator password. At least 8 characters, with three of: uppercase, lowercase, digits, symbols.')
@secure()
@minLength(8)
param postgresAdminPassword string

@description('Azure Static Web App region. The Free SKU is only offered in a few regions (westeurope, eastus2, westus2, centralus, eastasia).')
param staticSiteLocation string = 'westeurope'

@description('Azure Static Web App SKU. Free is enough for a CDN-hosted Angular build.')
@allowed(['Free', 'Standard'])
param staticSiteSku string = 'Free'

@description('Google OIDC client id. Leave empty to hide the Google button.')
param oidcGoogleClientId string = ''
@secure()
param oidcGoogleClientSecret string = ''
@description('Microsoft Entra ID client id.')
param oidcMicrosoftClientId string = ''
@secure()
param oidcMicrosoftClientSecret string = ''
@description('Microsoft Entra ID tenant: common, organizations, consumers, or a tenant id/domain.')
param oidcMicrosoftTenant string = 'common'
@description('GitHub OAuth client id.')
param oidcGithubClientId string = ''
@secure()
param oidcGithubClientSecret string = ''

@description('Optional magic-link delivery webhook. Leave empty while COMPLY_DEV_LINKS is 0 and email is not configured.')
param mailWebhookUrl string = ''

var suffix = uniqueString(resourceGroup().id)
// appName is capped at 11 characters, so the storage name stays within the 24-character limit.
var storageName = toLower('${appName}${suffix}')
var planName = '${appName}-plan'
var functionName = '${appName}-${suffix}'
var staticSiteName = '${appName}-web-${suffix}'
var postgresName = '${appName}-pg-${suffix}'
var containerName = 'comply'
var databaseName = 'comply'
// Computed instead of read from the site resource: app settings inside `site` cannot reference
// the resource they belong to.
var defaultFunctionUrl = 'https://${functionName}.azurewebsites.net'

var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

// Npgsql accepts SSL Mode=Require against Flexible Server; the server certificate is not in the
// public trust store for the *.postgres.database.azure.com endpoint, so trust it explicitly.
var postgresConnectionString = 'Host=${postgres.properties.fullyQualifiedDomainName};Port=5432;Database=${databaseName};Username=${postgresAdminLogin};Password=${postgresAdminPassword};SSL Mode=Require;Trust Server Certificate=true'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: containerName
  properties: {
    publicAccess: 'None'
  }
}

// Y1 consumption plan. The Functions host still needs a storage account for its own state even
// when every trigger is HTTP.
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  sku: { name: 'Y1', tier: 'Dynamic' }
  properties: { reserved: true }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresName
  location: location
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: 32 }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: { mode: 'Disabled' }
  }
}

resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// 0.0.0.0-0.0.0.0 is the Azure services rule. The Function App has no fixed egress address on the
// consumption plan, so the database is reachable from Azure but not from the public internet.
resource postgresFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource site 'Microsoft.Web/sites@2023-12-01' = {
  name: functionName
  location: location
  kind: 'functionapp,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOTNET-ISOLATED|8.0'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      alwaysOn: false
      appSettings: [
        { name: 'AzureWebJobsStorage', value: storageConnectionString }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'dotnet-isolated' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
        { name: 'COMPLY_DB_CONNECTION', value: postgresConnectionString }
        { name: 'COMPLY_DB_MIGRATE', value: '1' }
        { name: 'COMPLY_AUTH_SECRET', value: authSecret }
        // CORS allowlist and sign-in redirect target: the Angular origin.
        { name: 'COMPLY_APP_URL', value: !empty(publicUrl) ? publicUrl : 'https://${staticSite.properties.defaultHostname}' }
        // OIDC redirect_uri base and public API origin.
        { name: 'COMPLY_PUBLIC_URL', value: !empty(apiUrl) ? apiUrl : defaultFunctionUrl }
        { name: 'COMPLY_DATA_DIR', value: '/home/data' }
        { name: 'COMPLY_SEED_DIR', value: '/home/site/wwwroot/seed' }
        { name: 'COMPLY_BLOB_CONNECTION_STRING', value: storageConnectionString }
        { name: 'COMPLY_BLOB_CONTAINER', value: containerName }
        { name: 'COMPLY_OIDC_GOOGLE_CLIENT_ID', value: oidcGoogleClientId }
        { name: 'COMPLY_OIDC_GOOGLE_CLIENT_SECRET', value: oidcGoogleClientSecret }
        { name: 'COMPLY_OIDC_MICROSOFT_CLIENT_ID', value: oidcMicrosoftClientId }
        { name: 'COMPLY_OIDC_MICROSOFT_CLIENT_SECRET', value: oidcMicrosoftClientSecret }
        { name: 'COMPLY_OIDC_MICROSOFT_TENANT', value: oidcMicrosoftTenant }
        { name: 'COMPLY_OIDC_GITHUB_CLIENT_ID', value: oidcGithubClientId }
        { name: 'COMPLY_OIDC_GITHUB_CLIENT_SECRET', value: oidcGithubClientSecret }
        { name: 'COMPLY_MAIL_WEBHOOK_URL', value: mailWebhookUrl }
        { name: 'COMPLY_DEV_LINKS', value: '0' }
      ]
    }
  }
}

// Static host for the Angular build only. No linked backend: the bundle reads apiBase from
// config.js and calls the Function App cross-origin.
resource staticSite 'Microsoft.Web/staticSites@2023-12-01' = {
  name: staticSiteName
  location: staticSiteLocation
  sku: { name: staticSiteSku, tier: staticSiteSku }
  properties: {}
}

output functionAppName string = site.name
output functionUrl string = 'https://${site.properties.defaultHostName}'
output apiUrl string = !empty(apiUrl) ? apiUrl : defaultFunctionUrl
output staticSiteName string = staticSite.name
output staticSiteUrl string = 'https://${staticSite.properties.defaultHostname}'
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output postgresDatabase string = databaseName
output blobEndpoint string = storage.properties.primaryEndpoints.blob
output blobContainer string = containerName
