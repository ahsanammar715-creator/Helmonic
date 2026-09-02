[CmdletBinding()]
param(
  [string]$SourceRoot = 'S:\z_Helmonic_iAcoustics',
  [string]$OutputDirectory,
  [ValidateSet('all', 'sample')]
  [string]$PageMode = 'all',
  [switch]$Restart
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $repoRoot 'local-artifacts\corpus-audit'
}

$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (Test-Path -LiteralPath $bundledPython) {
  $python = $bundledPython
} else {
  $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
  if (-not $pythonCommand) {
    throw 'Python with pypdf is required. The bundled Codex Python runtime was not found.'
  }
  $python = $pythonCommand.Source
}

if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) {
  throw "The corpus folder is not accessible in this Windows session: $SourceRoot"
}

& $python -c 'import pypdf' 2>$null
if ($LASTEXITCODE -ne 0) {
  throw 'The selected Python runtime does not include pypdf; no scan was started.'
}

$arguments = @(
  (Join-Path $PSScriptRoot 'audit_corpus.py'),
  '--source', $SourceRoot,
  '--output', $OutputDirectory,
  '--page-mode', $PageMode
)
if ($Restart) {
  $arguments += '--restart'
}

Write-Host 'Starting a read-only Helmonic corpus audit.'
Write-Host "Source (never modified): $SourceRoot"
Write-Host "Local reports: $OutputDirectory"
Write-Host "PDF page analysis: $PageMode"
& $python @arguments
exit $LASTEXITCODE
