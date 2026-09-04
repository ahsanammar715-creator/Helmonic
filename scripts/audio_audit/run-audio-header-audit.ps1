param(
  [string]$SourceRoot = 'S:\z_Helmonic_iAcoustics',
  [int]$SamplePerGroup = 2
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$inventory = Join-Path $repoRoot 'local-artifacts\corpus-audit\inventory.csv'
$output = Join-Path $repoRoot 'local-artifacts\audio-audit'
$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'

if (-not (Test-Path -LiteralPath $bundledPython -PathType Leaf)) {
  $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
  if (-not $pythonCommand) { throw 'Python was not found.' }
  $bundledPython = $pythonCommand.Source
}
if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) {
  throw "Source root is unavailable: $SourceRoot"
}
if (-not (Test-Path -LiteralPath $inventory -PathType Leaf)) {
  throw "Completed corpus inventory is unavailable: $inventory"
}

Write-Host 'Starting read-only Helmonic WAV header audit.'
Write-Host "Source (never modified): $SourceRoot"
Write-Host "Reports: $output"
Write-Host 'Audio bodies are not decoded, copied, played, transcribed, or uploaded.'

& $bundledPython (Join-Path $PSScriptRoot 'audit_audio_headers.py') `
  --source-root $SourceRoot `
  --inventory $inventory `
  --output-dir $output `
  --sample-per-group $SamplePerGroup
exit $LASTEXITCODE
