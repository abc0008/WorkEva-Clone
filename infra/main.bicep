param appName string
param appServicePlanName string = '${appName}-plan'
param location string = resourceGroup().location
param sqlServerName string
param sqlDatabaseName string
param storageAccountName string
param containerName string = 'evidence'
param image string

// This template creates the Web App and private storage account shell. SQL,
// private endpoints, Entra EasyAuth and role assignments are deliberately
// supplied as existing, environment-owned resources; see runbook.md.
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  kind: 'linux'
  sku: {
    name: 'P1v3'
    tier: 'PremiumV3'
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    publicNetworkAccess: 'Disabled'
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}
resource evidence 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  name: '${storage.name}/default/${containerName}'
  properties: { publicAccess: 'None' }
}
resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  kind: 'app,linux,container'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOCKER|${image}'
      alwaysOn: true
      appSettings: [
        {
          name: 'WEBSITES_PORT'
          value: '3000'
        }
        {
          name: 'NODE_ENV'
          value: 'production'
        }
        {
          name: 'WORKEVA_LOCAL_MODE'
          value: 'false'
        }
        {
          name: 'AZURE_STORAGE_ACCOUNT_URL'
          value: storage.properties.primaryEndpoints.blob
        }
        {
          name: 'AZURE_STORAGE_CONTAINER'
          value: containerName
        }
        {
          name: 'AZURE_SQL_SERVER'
          value: '${sqlServerName}.database.windows.net'
        }
        {
          name: 'AZURE_SQL_DATABASE'
          value: sqlDatabaseName
        }
      ]
    }
  }
}
output appPrincipalId string = app.identity.principalId
output storageEndpoint string = storage.properties.primaryEndpoints.blob
