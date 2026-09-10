[CmdletBinding()]
param([Parameter(Mandatory)][string]$DistDir)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $DistDir).Path
. "$PSScriptRoot/check_windows_x64.ps1"
Assert-WindowsX64Bundle $root | Out-Null
if ($env:SIGNING_ENABLED -notin $null, '', '0', '1') { throw 'SIGNING_ENABLED must be 0 or 1.' }
if ($env:RELEASE_BUILD -eq '1' -and $env:SIGNING_ENABLED -ne '1' -and $env:ALLOW_UNSIGNED_RELEASE -ne '1') { throw 'Release requires signing or explicit ALLOW_UNSIGNED_RELEASE=1.' }
if ($env:SIGNING_ENABLED -eq '1') {
    & "$PSScriptRoot/sign_windows_release.ps1" -DistDir $root
    $label = 'signed'
} else {
    & "$PSScriptRoot/sign_windows_release.ps1" -DistDir $root -AuditOnly
    $label = 'unsigned'
}
# Runtime checks use the extracted final ZIP via verify_windows_release.ps1.
$infoPath = Join-Path $root 'release-info.json'
$info = Get-Content -LiteralPath $infoPath -Raw | ConvertFrom-Json
$info | Add-Member -NotePropertyName signingStatus -NotePropertyValue $label -Force
$info | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $infoPath -Encoding UTF8
$zip = if ($env:RELEASE_BUILD -eq '1') { "$root.zip" } else { "$root-$label.zip" }
if (Test-Path -LiteralPath $zip) { throw "Output already exists; select a fresh staging directory: $zip" }
Add-Type -AssemblyName System.IO.Compression.FileSystem
# ZipFile supports ZIP64, unlike Compress-Archive's 2 GB per-file limit.
try {
    [IO.Compression.ZipFile]::CreateFromDirectory($root, $zip, [IO.Compression.CompressionLevel]::Optimal, $true)
} catch {
    if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip }
    throw
}
(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash | Set-Content -LiteralPath "$zip.sha256" -Encoding ASCII
Write-Host "Packaged $label distribution: $zip"
