[CmdletBinding()]
param(
    [string]$SourceDirectory = 'S:\z_Helmonic_iAcoustics',
    [string]$OutputDirectory,
    [string[]]$PstPath,
    [switch]$Build
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repoRoot 'local-artifacts\pst-audit\reports'
}

$executable = Join-Path $repoRoot 'local-artifacts\pst-audit\build\PstMetadataAudit.exe'
if ($Build -or -not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    & (Join-Path $PSScriptRoot 'build-pst-audit.ps1')
}

if (-not (Test-Path -LiteralPath $SourceDirectory -PathType Container)) {
    throw "PST source directory is unavailable: $SourceDirectory"
}

$selected = [Collections.Generic.List[IO.FileInfo]]::new()
if ($PstPath -and $PstPath.Count -gt 0) {
    foreach ($path in $PstPath) {
        $selected.Add((Get-Item -LiteralPath $path))
    }
}
else {
    foreach ($pattern in @('backup_glen*.pst', 'backup_owen*.pst')) {
        $matches = @(Get-ChildItem -LiteralPath $SourceDirectory -File -Filter $pattern)
        if ($matches.Count -ne 1) {
            throw "Expected exactly one $pattern at the source root; found $($matches.Count)."
        }
        $selected.Add($matches[0])
    }

    $jim = @(Get-ChildItem -LiteralPath $SourceDirectory -File -Filter '*jim*.pst')
    if ($jim.Count -gt 1) {
        throw "Found more than one Jim PST candidate. Re-run with explicit -PstPath values."
    }
    if ($jim.Count -eq 1) {
        $selected.Add($jim[0])
    }
    else {
        Write-Warning 'Jim PST is not present yet. Glen and Owen will be processed; this is not an error.'
    }
}

$arguments = [Collections.Generic.List[string]]::new()
$arguments.Add((Resolve-Path -LiteralPath (New-Item -ItemType Directory -Path $OutputDirectory -Force)).Path)
foreach ($pst in $selected) {
    $base = [IO.Path]::GetFileNameWithoutExtension($pst.Name).ToLowerInvariant()
    $label = if ($base -match 'glen') { 'glen' } elseif ($base -match 'owen') { 'owen' } elseif ($base -match 'jim') { 'jim' } else { $base }
    $arguments.Add("$label=$($pst.FullName)")
}

Write-Output 'Starting local, read-only PST metadata inventory.'
Write-Output 'Email bodies: forbidden. Attachment contents: forbidden. Azure calls: none.'
Write-Output "Reports: $OutputDirectory"
& $executable @arguments
exit $LASTEXITCODE
