[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ZipPath,
    [Parameter(Mandatory)][string]$ExtractDir,
    [switch]$RuntimeChecks
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$zipPathResolved = (Resolve-Path -LiteralPath $ZipPath).Path
$destination = [IO.Path]::GetFullPath($ExtractDir)
if (Test-Path -LiteralPath $destination) { throw 'Choose a new, empty extraction destination.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zipPathResolved)
try {
    $top = @($archive.Entries | ForEach-Object { ($_.FullName -split '/')[0] } | Sort-Object -Unique)
    if ($top.Count -ne 1 -or $top[0] -notmatch '^SegRef3D-Local-GPU-v[0-9.]+-Windows$') { throw 'Unexpected ZIP root.' }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $archive.Entries) {
        $target = [IO.Path]::GetFullPath((Join-Path $destination $entry.FullName))
        if (-not $target.StartsWith($destination.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe ZIP path.' }
        if (-not $seen.Add($target)) { throw 'Duplicate ZIP path.' }
        $vendorLicense = $entry.FullName -match '\.dist-info/licenses/'
        if (-not $vendorLicense -and $entry.FullName -match '(^|/)(__pycache__|\.pytest_cache|\.git|tests|test)/|\.(pfx|p12|key|pyc|pyo|pdb|dmp|ipynb)$') { throw "Unexpected release artifact: $($entry.FullName)" }
    }
    if (-not $archive.GetEntry($top[0] + '/SegRef3D.exe')) { throw 'SegRef3D.exe missing.' }
} finally { $archive.Dispose() }
[IO.Compression.ZipFile]::ExtractToDirectory($zipPathResolved, $destination)
$root = Join-Path $destination $top[0]
$info = Get-Content -LiteralPath (Join-Path $root 'release-info.json') -Raw | ConvertFrom-Json
$summary = [ordered]@{ Zip = $zipPathResolved; Bytes = (Get-Item -LiteralPath $zipPathResolved).Length; SHA256 = (Get-FileHash -LiteralPath $zipPathResolved -Algorithm SHA256).Hash; Root = $root; Version = $info.version; SourceCommit = $info.sourceCommit; SigningStatus = $info.signingStatus; Checks = @() }
if ($RuntimeChecks) {
    foreach ($argument in '--vtk-check', '--gpu-check', '--startup-smoke-test') {
        $name = $argument.TrimStart('-')
        $stdout = Join-Path $destination "$name.stdout.log"
        $stderr = Join-Path $destination "$name.stderr.log"
        $style = if ($argument -eq '--startup-smoke-test') { 'Normal' } else { 'Hidden' }
        $process = Start-Process -FilePath (Join-Path $root 'SegRef3D.exe') -ArgumentList $argument -WorkingDirectory $destination -WindowStyle $style -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        if (-not $process.WaitForExit(120000)) { $process.Kill(); throw "Timed out: $argument" }
        $process.Refresh()
        $summary.Checks += [ordered]@{ Argument = $argument; ExitCode = $process.ExitCode; Stdout = $stdout; Stderr = $stderr }
    }
}
$summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $destination 'verification.json') -Encoding UTF8
$summary | ConvertTo-Json -Depth 5
# A policy block remains recorded as a failed runtime check; it is never described as success.
