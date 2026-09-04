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

  [Parameter(Mandatory)]
  [ValidateSet("true", "false")]
  [string] $HybridRetrievalEnabled,

  [Parameter(Mandatory)]
  [ValidatePattern("^[a-z0-9][a-z0-9-]{0,127}$")]
  [string] $SearchIndex,

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

  [string] $EmbeddingEndpoint,
  [string] $EmbeddingDeployment,

  [ValidatePattern("^[0-9]{4}-[0-9]{2}-[0-9]{2}(-preview)?$")]
  [string] $EmbeddingApiVersion = "2024-10-21",

  [ValidateRange(1, 4096)]
  [int] $EmbeddingDimensions = 1536,

  [ValidateRange(1, 1000)]
  [int] $VectorK = 50,

  [string] $SemanticConfiguration = "consult-semantic-v2",

  [ValidateRange(0.01, 4.0)]
  [double] $MinimumSemanticScore = 2.0,

  [ValidateRange(0.0001, 1.0)]
  [double] $MinimumRrfScore = 0.015,

  [ValidatePattern("^[a-z0-9][a-z0-9-]{0,62}$")]
  [string] $RevisionSuffix,

  [string] $AzureCli = "az",
  [string] $ResourceGroup = "RG-HELMONIC-DEV",
  [string] $ContainerApp = "ca-helmonic-consult-dev-002",
  [string] $RegistryLoginServer = "acrhelmonicdev001-etd4eqevdcf6e7bs.azurecr.io"
)

$ErrorActionPreference = "Stop"
$modelConfigured = [bool]$ModelEndpoint -and [bool]$ModelDeployment
$hybridConfigured = $HybridRetrievalEnabled -eq "true"
if ([bool]$ModelEndpoint -ne [bool]$ModelDeployment) {
  throw "ModelEndpoint and ModelDeployment must be supplied together"
}
if ($ModelEndpoint -and $ModelEndpoint -notmatch '^https://[^/]+$') {
  throw "ModelEndpoint must be an HTTPS origin without a path or trailing slash"
}
if ($hybridConfigured) {
  if (-not $EmbeddingEndpoint -or -not $EmbeddingDeployment) {
    throw "EmbeddingEndpoint and EmbeddingDeployment are required for hybrid retrieval"
  }
  if ($EmbeddingEndpoint -notmatch '^https://[^/]+$') {
    throw "EmbeddingEndpoint must be an HTTPS origin without a path or trailing slash"
  }
  if ($SearchIndex -eq "consult-demo-v1") {
    throw "Hybrid retrieval must use a versioned index and cannot target consult-demo-v1"
  }
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
  "AZURE_SEARCH_INDEX=$SearchIndex",
  "HELMONIC_HYBRID_RETRIEVAL_ENABLED=$HybridRetrievalEnabled",
  "HELMONIC_SEARCH_SEMANTIC_ENABLED=$(if ($hybridConfigured) { 'true' } else { 'false' })",
  "HELMONIC_ALLOW_RETRIEVAL_ONLY=$(if ($modelConfigured) { 'false' } else { 'true' })",
  "HELMONIC_READINESS_CHECKS=$(if ($hybridConfigured -and $modelConfigured) { 'search,postgres,blob,keyvault,model,embedding' } elseif ($hybridConfigured) { 'search,postgres,blob,keyvault,embedding' } elseif ($modelConfigured) { 'search,postgres,blob,keyvault,model' } else { 'search,postgres,blob,keyvault' })"
)
$modelEnvironmentNames = @(
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_DEPLOYMENT",
  "AZURE_OPENAI_API_VERSION",
  "AZURE_OPENAI_REASONING_EFFORT",
  "AZURE_OPENAI_MAX_COMPLETION_TOKENS",
  "AZURE_OPENAI_TIMEOUT_MS"
)
$hybridEnvironmentNames = @(
  "AZURE_OPENAI_EMBEDDING_ENDPOINT",
  "AZURE_OPENAI_EMBEDDING_DEPLOYMENT",
  "AZURE_OPENAI_EMBEDDING_API_VERSION",
  "AZURE_OPENAI_EMBEDDING_DIMENSIONS",
  "HELMONIC_SEARCH_VECTOR_K",
  "AZURE_SEARCH_SEMANTIC_CONFIGURATION",
  "HELMONIC_SEARCH_MIN_SEMANTIC_SCORE",
  "HELMONIC_SEARCH_MIN_RRF_SCORE"
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
if ($hybridConfigured) {
  $featureFlags += @(
    "AZURE_OPENAI_EMBEDDING_ENDPOINT=$EmbeddingEndpoint",
    "AZURE_OPENAI_EMBEDDING_DEPLOYMENT=$EmbeddingDeployment",
    "AZURE_OPENAI_EMBEDDING_API_VERSION=$EmbeddingApiVersion",
    "AZURE_OPENAI_EMBEDDING_DIMENSIONS=$EmbeddingDimensions",
    "HELMONIC_SEARCH_VECTOR_K=$VectorK",
    "AZURE_SEARCH_SEMANTIC_CONFIGURATION=$SemanticConfiguration",
    "HELMONIC_SEARCH_MIN_SEMANTIC_SCORE=$MinimumSemanticScore",
    "HELMONIC_SEARCH_MIN_RRF_SCORE=$MinimumRrfScore"
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
  $removeEnvironmentNames = @()
  if (-not $modelConfigured) {
    $removeEnvironmentNames += $modelEnvironmentNames
  }
  if (-not $hybridConfigured) {
    $removeEnvironmentNames += $hybridEnvironmentNames
  }
  if ($removeEnvironmentNames.Count -gt 0) {
    $updateArguments += @("--remove-env-vars") + $removeEnvironmentNames
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
    hybridRetrievalEnabled = $actualEnvironment.HELMONIC_HYBRID_RETRIEVAL_ENABLED
    searchIndex = $actualEnvironment.AZURE_SEARCH_INDEX
    embeddingDeployment = $actualEnvironment.AZURE_OPENAI_EMBEDDING_DEPLOYMENT
    semanticConfiguration = $actualEnvironment.AZURE_SEARCH_SEMANTIC_CONFIGURATION
    minimumSemanticScore = $actualEnvironment.HELMONIC_SEARCH_MIN_SEMANTIC_SCORE
    modelDeployment = $actualEnvironment.AZURE_OPENAI_DEPLOYMENT
    modelReasoningEffort = $actualEnvironment.AZURE_OPENAI_REASONING_EFFORT
    modelMaximumCompletionTokens = $actualEnvironment.AZURE_OPENAI_MAX_COMPLETION_TOKENS
    readinessChecks = $actualEnvironment.HELMONIC_READINESS_CHECKS
    trafficWeight = if ($newRevisionTraffic.Count) { $newRevisionTraffic[0].weight } else { 0 }
  }
}
