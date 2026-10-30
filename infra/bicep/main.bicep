targetScope = 'resourceGroup'

// Split hosting: the .NET 8 isolated Functions app serves /api, /mcp and /healthz, Azure Cosmos DB
// (serverless) holds users, assessments, evidence and MCP keys, and the Angular build is uploaded
// to an independent Azure Static Web App. The Static Web App never proxies /api, so the browser
// calls the Function App cross-origin; COMPLY_APP_URL is the CORS allowlist.

@description('Prefix for every resource name. Keep it short and lowercase.')
@minLength(3)
@maxLength(11)
param appName string = 'comply'

@description('Azure region for the Function App, storage account and Cosmos DB account.')
param location string = resourceGroup().location

@description('Public origin of the Angular build (the CDN or Static Web App URL). Leave empty to use the Static Web App hostname created here.')
param publicUrl string = ''

@description('Public origin of the API (custom domain in front of the Function App). Leave empty to use the Function App hostname.')
param apiUrl string = ''

@description('HMAC secret for sessions, magic links and OIDC state. Generate with: openssl rand -hex 32')
@secure()
param authSecret string

@description('Cosmos DB database name. The app and every container use this value.')
@minLength(1)
@maxLength(255)
param cosmosDatabaseName string = 'comply'

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
var cosmosName = toLower('${appName}-${suffix}')
var containerName = 'comply'
// Containers use the same names and partition keys as CosmosComplyStore.
var cosmosContainers = [
  { name: 'organizations', partitionKey: '/id' }
  { name: 'users', partitionKey: '/id' }
  { name: 'email_locks', partitionKey: '/id' }
  { name: 'external_logins', partitionKey: '/id' }
  { name: 'assessments', partitionKey: '/organizationId' }
  { name: 'mcp_keys', partitionKey: '/organizationId' }
]
// Computed instead of read from the site resource: app settings inside `site` cannot reference
// the resource they belong to.
var defaultFunctionUrl = 'https://${functionName}.azurewebsites.net'

var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

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

// Serverless Cosmos DB: no provisioned throughput, billed per request. The connection string is
// read with listConnectionStrings so rotating keys in the portal does not change this template.
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [{ locationName: location, failoverPriority: 0 }]
    capabilities: [{ name: 'EnableServerless' }]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    minimalTlsVersion: 'Tls12'
  }
}

resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: cosmosDatabaseName
  properties: {
    resource: { id: cosmosDatabaseName }
  }
}

resource cosmosContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = [
  for container in cosmosContainers: {
    parent: cosmosDatabase
    name: container.name
    properties: {
      resource: {
        id: container.name
        partitionKey: { paths: [container.partitionKey], kind: 'Hash' }
      }
    }
  }
]

var cosmosConnectionString = cosmos.listConnectionStrings().connectionStrings[0].connectionString

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
        { name: 'COMPLY_COSMOS_CONNECTION', value: cosmosConnectionString }
        { name: 'COMPLY_COSMOS_DATABASE', value: cosmosDatabaseName }
        // Containers come from this template, so the worker does not try to create them at boot.
        { name: 'COMPLY_COSMOS_CREATE_CONTAINERS', value: '0' }
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
output cosmosAccountName string = cosmos.name
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output cosmosDatabase string = cosmosDatabaseName
output blobEndpoint string = storage.properties.primaryEndpoints.blob
output blobContainer string = containerName
