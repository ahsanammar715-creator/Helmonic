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

  [string] $ModelEndpoint,
  [string] $ModelDeployment,

  [ValidatePattern("^[0-9]{4}-[0-9]{2}-[0-9]{2}(-preview)?$")]
  [string] $ModelApiVersion = "2024-10-21",

  [ValidateSet("none", "low", "medium", "high", "xhigh")]
  [string] $ModelReasoningEffort = "high",

  [ValidateRange(1, 128000)]
  [int] $ModelMaximumCompletionTokens = 2000,

  [ValidateRange(1000, 300000)]
  [int] $ModelTimeoutMilliseconds = 120000,

  [ValidatePattern("^[a-z0-9][a-z0-9-]{0,62}$")]
  [string] $RevisionSuffix,

  [string] $AzureCli = "az",
  [string] $ResourceGroup = "RG-HELMONIC-DEV",
  [string] $ContainerApp = "ca-helmonic-consult-dev-002",
  [string] $RegistryLoginServer = "acrhelmonicdev001-etd4eqevdcf6e7bs.azurecr.io"
)

$ErrorActionPreference = "Stop"
$modelConfigured = [bool]$ModelEndpoint -and [bool]$ModelDeployment
if ([bool]$ModelEndpoint -ne [bool]$ModelDeployment) {
  throw "ModelEndpoint and ModelDeployment must be supplied together"
}
if ($ModelEndpoint -and $ModelEndpoint -notmatch '^https://[^/]+$') {
  throw "ModelEndpoint must be an HTTPS origin without a path or trailing slash"
}
$image = "$RegistryLoginServer/helmonic-consult:$ImageTag"
if (-not $RevisionSuffix) {
  $RevisionSuffix = "p1b$($ImageTag.Substring(0, 7))"
}
$featureFlags = @(
  "HELMONIC_APP_VERSION=$ImageTag",
  "HELMONIC_PHASE1B_UPLOADS_ENABLED=$UploadsEnabled",
  "HELMONIC_PHASE1B_FOLDERS_ENABLED=$FoldersEnabled",
  "HELMONIC_GENERAL_CONTEXT_ENABLED=$GeneralContextEnabled",
  "HELMONIC_ALLOW_RETRIEVAL_ONLY=$(if ($modelConfigured) { 'false' } else { 'true' })",
  "HELMONIC_READINESS_CHECKS=$(if ($modelConfigured) { 'search,postgres,blob,keyvault,model' } else { 'search,postgres,blob,keyvault' })"
)
$modelEnvironmentNames = @(
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_DEPLOYMENT",
  "AZURE_OPENAI_API_VERSION",
  "AZURE_OPENAI_REASONING_EFFORT",
  "AZURE_OPENAI_MAX_COMPLETION_TOKENS",
  "AZURE_OPENAI_TIMEOUT_MS"
)
if ($modelConfigured) {
  $featureFlags += @(
    "AZURE_OPENAI_ENDPOINT=$ModelEndpoint",
    "AZURE_OPENAI_DEPLOYMENT=$ModelDeployment",
    "AZURE_OPENAI_API_VERSION=$ModelApiVersion",
    "AZURE_OPENAI_REASONING_EFFORT=$ModelReasoningEffort",
    "AZURE_OPENAI_MAX_COMPLETION_TOKENS=$ModelMaximumCompletionTokens",
    "AZURE_OPENAI_TIMEOUT_MS=$ModelTimeoutMilliseconds"
  )
}

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
  $updateArguments = @(
    "containerapp", "update",
    "--resource-group", $ResourceGroup,
    "--name", $ContainerApp,
    "--image", $image,
    "--revision-suffix", $RevisionSuffix,
    "--set-env-vars"
  ) + $featureFlags
  if (-not $modelConfigured) {
    $updateArguments += @("--remove-env-vars") + $modelEnvironmentNames
  }
  $updateArguments += @("--output", "none")
  & $AzureCli @updateArguments
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
    modelDeployment = $actualEnvironment.AZURE_OPENAI_DEPLOYMENT
    modelReasoningEffort = $actualEnvironment.AZURE_OPENAI_REASONING_EFFORT
    modelMaximumCompletionTokens = $actualEnvironment.AZURE_OPENAI_MAX_COMPLETION_TOKENS
    readinessChecks = $actualEnvironment.HELMONIC_READINESS_CHECKS
    trafficWeight = if ($newRevisionTraffic.Count) { $newRevisionTraffic[0].weight } else { 0 }
  }
}
