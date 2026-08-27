[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)]
  [ValidatePattern("^[0-9a-f]{40}$")]
  [string] $ImageTag,

  [Parameter(Mandatory)]
  [ValidateSet("true", "false")]
  [string] $UploadsEnabled,

  [Parameter(Mandatory)]
  [ValidateSet("true", "false")]
  [string] $FoldersEnabled,

  [Parameter(Mandatory)]
  [ValidateSet("true", "false")]
  [string] $GeneralContextEnabled,

  [ValidatePattern("^[a-z0-9][a-z0-9-]{0,62}$")]
  [string] $RevisionSuffix,

  [string] $AzureCli = "az",
  [string] $ResourceGroup = "RG-HELMONIC-DEV",
  [string] $ContainerApp = "ca-helmonic-consult-dev-002",
  [string] $RegistryLoginServer = "acrhelmonicdev001-etd4eqevdcf6e7bs.azurecr.io"
)

$ErrorActionPreference = "Stop"
$image = "$RegistryLoginServer/helmonic-consult:$ImageTag"
if (-not $RevisionSuffix) {
  $RevisionSuffix = "p1b$($ImageTag.Substring(0, 7))"
}
$featureFlags = @(
  "HELMONIC_APP_VERSION=$ImageTag",
  "HELMONIC_PHASE1B_UPLOADS_ENABLED=$UploadsEnabled",
  "HELMONIC_PHASE1B_FOLDERS_ENABLED=$FoldersEnabled",
  "HELMONIC_GENERAL_CONTEXT_ENABLED=$GeneralContextEnabled"
)

$revisionMode = & $AzureCli containerapp show `
  --resource-group $ResourceGroup `
  --name $ContainerApp `
  --query "properties.configuration.activeRevisionsMode" `
  --output tsv
if ($LASTEXITCODE -ne 0) {
  throw "Unable to inspect the Container App revision mode"
}
if ($revisionMode -ne "Multiple") {
  throw "Refusing deployment because activeRevisionsMode is '$revisionMode', not 'Multiple'"
}

$revisionName = "$ContainerApp--$RevisionSuffix"
$existingRevision = & $AzureCli containerapp revision list `
  --resource-group $ResourceGroup `
  --name $ContainerApp `
  --all `
  --query "[?name=='$revisionName'].name | [0]" `
  --output tsv
if ($LASTEXITCODE -ne 0) {
  throw "Unable to inspect existing revisions"
}
if ($existingRevision) {
  throw "Refusing deployment because revision $revisionName already exists"
}

if ($PSCmdlet.ShouldProcess(
    "$ResourceGroup/$ContainerApp",
    "Create zero-traffic revision $RevisionSuffix from explicit image and feature flags"
  )) {
  & $AzureCli containerapp update `
    --resource-group $ResourceGroup `
    --name $ContainerApp `
    --image $image `
    --revision-suffix $RevisionSuffix `
    --set-env-vars $featureFlags `
    --output none
  if ($LASTEXITCODE -ne 0) {
    throw "Container App template update failed"
  }

  $revision = & $AzureCli containerapp revision show `
    --resource-group $ResourceGroup `
    --name $ContainerApp `
    --revision $revisionName `
    --query "{name:name,active:properties.active,replicas:properties.replicas,image:properties.template.containers[0].image,env:properties.template.containers[0].env}" `
    --output json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to verify the new revision"
  }
  if ($revision.image -ne $image) {
    throw "Revision image verification failed"
  }

  $actualEnvironment = @{}
  foreach ($item in $revision.env) {
    $actualEnvironment[$item.name] = $item.value
  }
  foreach ($expected in $featureFlags) {
    $name, $value = $expected -split "=", 2
    if ($actualEnvironment[$name] -ne $value) {
      throw "Revision environment verification failed for $name"
    }
  }

  $traffic = & $AzureCli containerapp ingress traffic show `
    --resource-group $ResourceGroup `
    --name $ContainerApp `
    --output json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to verify traffic after template update"
  }
  $newRevisionTraffic = @($traffic | Where-Object revisionName -eq $revision.name)
  if ($newRevisionTraffic.Count -gt 0 -and $newRevisionTraffic[0].weight -ne 0) {
    throw "New revision unexpectedly received live traffic"
  }

  [pscustomobject]@{
    revision = $revision.name
    image = $revision.image
    uploadsEnabled = $actualEnvironment.HELMONIC_PHASE1B_UPLOADS_ENABLED
    foldersEnabled = $actualEnvironment.HELMONIC_PHASE1B_FOLDERS_ENABLED
    generalContextEnabled = $actualEnvironment.HELMONIC_GENERAL_CONTEXT_ENABLED
    trafficWeight = if ($newRevisionTraffic.Count) { $newRevisionTraffic[0].weight } else { 0 }
  }
}
