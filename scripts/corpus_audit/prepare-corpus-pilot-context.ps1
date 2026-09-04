param(
    [Parameter(Mandatory = $true)]
    [string]$SourceRoot,
    [Parameter(Mandatory = $true)]
    [string]$OutputRoot
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$output = [IO.Path]::GetFullPath($OutputRoot)
$allowed = [IO.Path]::GetFullPath((Join-Path $repo 'private-build'))
if (-not $output.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The private build context must stay under private-build.'
}
if ((Test-Path -LiteralPath $output) -and -not (Test-Path -LiteralPath (Join-Path $output 'payload\checkpoint.json'))) {
    throw "Private corpus-pilot context already exists without a compatible checkpoint: $output"
}

$python = 'C:\Users\Alessandro.Saccarola\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'Bundled Python runtime is unavailable.' }
$manifest = Join-Path $repo 'local-artifacts\corpus-ingestion-manifest\full-ingestion-manifest.jsonl'
if (-not (Test-Path -LiteralPath $manifest)) { throw 'Private full ingestion manifest is unavailable.' }

New-Item -ItemType Directory -Path $output -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $output 'scripts\ingestion') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'package.json') -Destination $output
Copy-Item -LiteralPath (Join-Path $repo 'package-lock.json') -Destination $output
Copy-Item -LiteralPath (Join-Path $repo 'scripts\managed-identity.mjs') -Destination (Join-Path $output 'scripts')
Copy-Item -LiteralPath (Join-Path $repo 'scripts\corpus_audit\corpus_document_worker.py') -Destination (Join-Path $output 'scripts')
@('corpus-pilot-contract.mjs', 'index-parity.mjs', 'ingest-corpus-pilot.mjs') | ForEach-Object {
    Copy-Item -LiteralPath (Join-Path $repo "scripts\ingestion\$_") -Destination (Join-Path $output 'scripts\ingestion')
}
Copy-Item -LiteralPath (Join-Path $repo 'scripts\ingestion\Dockerfile.corpus-pilot') -Destination (Join-Path $output 'Dockerfile')

& $python (Join-Path $repo 'scripts\corpus_audit\build_corpus_pilot_payload.py') `
    --manifest $manifest `
    --source-root $SourceRoot `
    --output-dir (Join-Path $output 'payload')
if ($LASTEXITCODE -ne 0) { throw "Corpus pilot payload build failed with $LASTEXITCODE" }

Write-Output "Built private corpus-pilot context: $output"
