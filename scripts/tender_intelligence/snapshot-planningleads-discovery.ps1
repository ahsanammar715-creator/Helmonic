[CmdletBinding()]
param([string]$OutputPath)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $repoRoot 'local-artifacts\tender-intelligence\planningleads-discovery-28.json'
}
$bundledNode = 'C:\Users\Alessandro.Saccarola\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$node = if (Test-Path -LiteralPath $bundledNode -PathType Leaf) {
    $bundledNode
} else {
    (Get-Command node -ErrorAction Stop).Source
}
& $node --experimental-strip-types (Join-Path $PSScriptRoot 'snapshot-planningleads-discovery.mjs') $OutputPath
if ($LASTEXITCODE -ne 0) {
    throw "PlanningLeads snapshot failed with exit code $LASTEXITCODE."
}
