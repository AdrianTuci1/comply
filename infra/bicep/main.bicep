targetScope = 'resourceGroup'

@description('Globally unique prefix for the Function App and storage account.')
param appName string = 'comply'
param location string = resourceGroup().location
@secure()
param authSecret string
@description('Public origin, for example https://comply.azurewebsites.net')
param publicUrl string
param oidcGoogleClientId string = ''
@secure()
param oidcGoogleClientSecret string = ''
param oidcMicrosoftClientId string = ''
@secure()
param oidcMicrosoftClientSecret string = ''
param oidcGithubClientId string = ''
@secure()
param oidcGithubClientSecret string = ''

var storageName = toLower('${appName}${uniqueString(resourceGroup().id)}')
var planName = '${appName}-plan'
var functionName = '${appName}-${uniqueString(resourceGroup().id)}'
var containerName = 'comply'

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

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  sku: { name: 'Y1', tier: 'Dynamic' }
  properties: { reserved: true }
}

resource site 'Microsoft.Web/sites@2023-12-01' = {
  name: functionName
  location: location
  kind: 'functionapp,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
        { name: 'COMPLY_PUBLIC_URL', value: publicUrl }
        { name: 'COMPLY_APP_URL', value: publicUrl }
        { name: 'COMPLY_AUTH_SECRET', value: authSecret }
        { name: 'COMPLY_DATA_DIR', value: '/home/data' }
        { name: 'COMPLY_WEB_ROOT', value: '/home/site/wwwroot/web' }
        { name: 'COMPLY_BLOB_CONNECTION_STRING', value: storage.listKeys().keys[0].value }
        { name: 'COMPLY_BLOB_CONTAINER', value: containerName }
        { name: 'COMPLY_OIDC_GOOGLE_CLIENT_ID', value: oidcGoogleClientId }
        { name: 'COMPLY_OIDC_GOOGLE_CLIENT_SECRET', value: oidcGoogleClientSecret }
        { name: 'COMPLY_OIDC_MICROSOFT_CLIENT_ID', value: oidcMicrosoftClientId }
        { name: 'COMPLY_OIDC_MICROSOFT_CLIENT_SECRET', value: oidcMicrosoftClientSecret }
        { name: 'COMPLY_OIDC_GITHUB_CLIENT_ID', value: oidcGithubClientId }
        { name: 'COMPLY_OIDC_GITHUB_CLIENT_SECRET', value: oidcGithubClientSecret }
      ]
    }
  }
}

output functionAppName string = site.name
output functionUrl string = 'https://${site.properties.defaultHostName}'
output blobEndpoint string = storage.properties.primaryEndpoints.blob
output blobContainer string = containerName
