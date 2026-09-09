[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$DistDir,
    [Parameter(Mandatory)][string]$ReportPath
)
. "$PSScriptRoot/windows_signing_common.ps1"
$rows = @(Get-PeSignatureTable -DistDir $DistDir)
if ($rows.Count -eq 0) { throw 'No PE binaries found.' }
$rows | Export-Csv -LiteralPath $ReportPath -NoTypeInformation -Encoding UTF8
$rows | Group-Object Extension, Status | Select-Object Count, Name | Format-Table
Write-Host "Signature inventory: $ReportPath"
