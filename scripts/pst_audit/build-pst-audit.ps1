[CmdletBinding()]
param(
    [string]$XstReaderSource,
    [string]$RoslynCompiler
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$expectedXstCommit = '3b7856c8b3d01bdf8aa13744e476d1ef7761b832'

if ([string]::IsNullOrWhiteSpace($XstReaderSource)) {
    $XstReaderSource = Join-Path $repoRoot 'local-tools\xstreader-3b7856c\XstReader.Base'
}
if ([string]::IsNullOrWhiteSpace($RoslynCompiler)) {
    $RoslynCompiler = Join-Path $repoRoot 'local-tools\roslyn-4.14.0\tasks\net472\csc.exe'
}

if (-not (Test-Path -LiteralPath $XstReaderSource -PathType Container)) {
    throw "Pinned XstReader source is missing. Expected commit $expectedXstCommit at $XstReaderSource"
}
if (-not (Test-Path -LiteralPath $RoslynCompiler -PathType Leaf)) {
    throw "Local Roslyn compiler is missing: $RoslynCompiler"
}

$buildRoot = Join-Path $repoRoot 'local-artifacts\pst-audit\build'
$sourceCopy = Join-Path $buildRoot 'XstReader.Base'
$output = Join-Path $buildRoot 'PstMetadataAudit.exe'
$safeBuildPrefix = [IO.Path]::GetFullPath((Join-Path $repoRoot 'local-artifacts\pst-audit')) + [IO.Path]::DirectorySeparatorChar
if (-not ([IO.Path]::GetFullPath($sourceCopy) + [IO.Path]::DirectorySeparatorChar).StartsWith(
        $safeBuildPrefix,
        [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean a build path outside the repository's local PST-audit area: $sourceCopy"
}
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
if (Test-Path -LiteralPath $sourceCopy) {
    Remove-Item -LiteralPath $sourceCopy -Recurse -Force
}
Copy-Item -LiteralPath $XstReaderSource -Destination $sourceCopy -Recurse

$xstFile = Join-Path $sourceCopy 'XstFile.cs'
$xstSource = [IO.File]::ReadAllText($xstFile)
$needle = 'public class XstFile'
# Windows PowerShell 5.1 can bind String.Split(string) as a character-array
# split. Regex.Matches gives the same exact-substring count in both 5.1 and 7+.
if ([regex]::Matches($xstSource, [regex]::Escape($needle)).Count -ne 1) {
    throw 'Pinned-source guard failed: expected exactly one XstFile class declaration.'
}
$xstSource = $xstSource.Replace($needle, 'public partial class XstFile')
[IO.File]::WriteAllText($xstFile, $xstSource, [Text.UTF8Encoding]::new($false))

$ndbFile = Join-Path $sourceCopy 'NDB.cs'
$ndbSource = [IO.File]::ReadAllText($ndbFile)
$ndbNeedle = 'private EbCryptMethod bCryptMethod;'
if ([regex]::Matches($ndbSource, [regex]::Escape($ndbNeedle)).Count -ne 1) {
    throw 'Pinned-source guard failed: expected exactly one NDB crypt-method field.'
}
$ndbSource = $ndbSource.Replace(
    $ndbNeedle,
    $ndbNeedle + "`r`n        internal EbCryptMethod CryptMethod { get { return bCryptMethod; } }")
[IO.File]::WriteAllText($ndbFile, $ndbSource, [Text.UTF8Encoding]::new($false))

# NETCOREAPP disables XstReader's optional WPF body-rendering code. The remaining
# unconditional namespace import is removed only from this ignored build copy.
$messageFile = Join-Path $sourceCopy 'Message.cs'
$messageSource = [IO.File]::ReadAllText($messageFile)
$messageSource = $messageSource.Replace("using System.Windows;`r`n", '')
$messageSource = $messageSource.Replace("using System.Windows;`n", '')
[IO.File]::WriteAllText($messageFile, $messageSource, [Text.UTF8Encoding]::new($false))

$auditSource = Join-Path $PSScriptRoot 'PstMetadataAudit.cs'
$extensionSource = Join-Path $PSScriptRoot 'MetadataOnlyXstFile.cs'

# Fail closed if the repo-owned code starts calling known payload APIs/properties.
$forbidden = @(
    '\.ReadMessageDetails\s*\(',
    '\.ReadAttachmentProperties\s*\(',
    '\.SaveAttachment(?:ToFolder|sToFolder)?\s*\(',
    'EpropertyTag\.PidTagAttachDataBinary',
    '\bpgMessageContent\b',
    '\.Properties\s*(?:\.|\[)'
)
$ownedSource = [IO.File]::ReadAllText($auditSource) + "`n" + [IO.File]::ReadAllText($extensionSource)
foreach ($pattern in $forbidden) {
    if ($ownedSource -match $pattern) {
        throw "Metadata-only source guard rejected forbidden payload access pattern: $pattern"
    }
}

$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
if (-not (Test-Path -LiteralPath (Join-Path $framework 'mscorlib.dll') -PathType Leaf)) {
    throw "Required .NET Framework 4.x reference assemblies are missing: $framework"
}
$references = @(
    'mscorlib.dll',
    'System.dll',
    'System.Core.dll',
    'System.Security.dll',
    'Microsoft.CSharp.dll'
) | ForEach-Object { '/reference:' + (Join-Path $framework $_) }

$sources = Get-ChildItem -LiteralPath $sourceCopy -Filter '*.cs' |
    Where-Object { $_.Name -ne 'AssemblyInfo.cs' } |
    Select-Object -ExpandProperty FullName
$sources += $extensionSource
$sources += $auditSource

& $RoslynCompiler /nologo /target:exe /optimize+ /unsafe /langversion:latest /define:NETCOREAPP `
    "/out:$output" $references $sources
if ($LASTEXITCODE -ne 0) {
    throw "PST audit compilation failed with exit code $LASTEXITCODE"
}

& $output --self-test
if ($LASTEXITCODE -ne 0) {
    throw 'PST audit self-test failed.'
}

Write-Output "Built metadata-only PST audit: $output"
Write-Output "XstReader pin: $expectedXstCommit"
