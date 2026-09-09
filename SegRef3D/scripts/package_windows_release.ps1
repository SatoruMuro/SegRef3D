[CmdletBinding()]
param([Parameter(Mandatory)][string]$DistDir)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $DistDir).Path
if ($env:SIGNING_ENABLED -notin $null, '', '0', '1') { throw 'SIGNING_ENABLED must be 0 or 1.' }
if ($env:RELEASE_BUILD -eq '1' -and $env:SIGNING_ENABLED -ne '1') { throw 'Production releases require SIGNING_ENABLED=1.' }
if ($env:SIGNING_ENABLED -eq '1') {
    & "$PSScriptRoot/sign_windows_release.ps1" -DistDir $root
    $label = 'signed'
} else {
    & "$PSScriptRoot/sign_windows_release.ps1" -DistDir $root -AuditOnly
    $label = 'unsigned'
}
# Checks run AFTER signing; imports must use the exact final bytes.
& (Join-Path $root 'SegRef3D.exe') --vtk-check
if ($LASTEXITCODE -ne 0) { throw 'Frozen VTK import failed; no ZIP produced.' }
& (Join-Path $root 'SegRef3D.exe') --gpu-check
if ($LASTEXITCODE -ne 0) { throw 'Frozen GPU check failed; no ZIP produced.' }
$zip = "$root-$label.zip"
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
