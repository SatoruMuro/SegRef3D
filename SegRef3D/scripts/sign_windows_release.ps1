[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$DistDir,
    [string]$ApprovalManifest,
    [string]$ReportDir,
    [switch]$AuditOnly,
    [string]$SignTool = $env:SIGNTOOL_PATH,
    [string]$CertificateThumbprint = $env:SIGNING_CERT_SHA1,
    [ValidateSet('CurrentUser', 'LocalMachine')][string]$StoreLocation = 'CurrentUser',
    [string]$TimestampUrl = $env:SIGNING_TIMESTAMP_URL
)
. "$PSScriptRoot/windows_signing_common.ps1"
if (-not $ApprovalManifest) { $ApprovalManifest = Join-Path $PSScriptRoot 'windows_signing_approvals.json' }
$root = (Resolve-Path -LiteralPath $DistDir).Path
if (-not (Test-Path -LiteralPath (Join-Path $root 'SegRef3D.exe') -PathType Leaf)) { throw 'SegRef3D.exe missing.' }
if (-not $ReportDir) { $ReportDir = "$root-signing" }
New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
$manifest = Get-Content -LiteralPath $ApprovalManifest -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1) { throw 'Unknown approval schema.' }
$approvals = @($manifest.files)
$before = @(Get-PeSignatureTable $root)
$plan = @($before | ForEach-Object {
    $_ | Add-Member -NotePropertyName Action -NotePropertyValue (Get-SigningAction $_ $approvals) -PassThru
})
$plan | Export-Csv -LiteralPath (Join-Path $ReportDir 'before.csv') -NoTypeInformation -Encoding UTF8
$plan | Group-Object Action | Select-Object Count, Name | Format-Table
if ($AuditOnly) { Write-Host 'Audit only: no files signed; NeedsReview/BlockedSignature prevent release.'; return }
if ($env:SIGNING_ENABLED -cne '1') { throw 'Set SIGNING_ENABLED=1 explicitly to sign.' }
if ($plan | Where-Object { $_.Action -in 'NeedsReview', 'BlockedSignature' }) { throw 'Preflight blocked. Review before.csv; no files have been signed.' }
if (-not $SignTool) { $SignTool = (Get-Command signtool.exe -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath $SignTool -PathType Leaf)) { throw 'SignTool not found.' }
if ($CertificateThumbprint -notmatch '^[0-9A-Fa-f]{40}$') { throw 'Exact certificate thumbprint required (SIGNING_CERT_SHA1).' }
$uri = $null
if (-not [Uri]::TryCreate($TimestampUrl, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -notin 'http', 'https') { throw 'RFC3161 SIGNING_TIMESTAMP_URL required.' }
$certificate = Get-Item -LiteralPath "Cert:\$StoreLocation\My\$CertificateThumbprint"
if (-not $certificate.HasPrivateKey -or $certificate.PublicKey.Oid.Value -ne '1.2.840.113549.1.1.1' -or $certificate.NotAfter -le (Get-Date) -or $certificate.NotBefore -gt (Get-Date)) { throw 'A current RSA signing certificate with private key is required.' }
if ('1.3.6.1.5.5.7.3.3' -notin @($certificate.EnhancedKeyUsageList | ForEach-Object { $_.ObjectId })) { throw 'Certificate must have code signing EKU.' }
$chain = [Security.Cryptography.X509Certificates.X509Chain]::new()
try {
    if (-not $chain.Build($certificate)) { throw 'Signing certificate chain is not trusted.' }
} finally { $chain.Dispose() }
# Preflight existing vendor signatures before the first mutation.
foreach ($row in $plan | Where-Object { $_.Action -in 'Preserve', 'VerifyEmbedded' }) {
    Invoke-CheckedSignTool $SignTool @('verify', '/pa', '/all', '/v', (Join-Path $root $row.Path))
}
try {
    foreach ($row in $plan | Where-Object { $_.Action -in 'SignApp', 'SignReviewedDependency' }) {
        $file = Join-Path $root $row.Path
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $row.SHA256) { throw "File changed since audit: $($row.Path)" }
        $sig = Get-AuthenticodeSignature -LiteralPath $file
        if ($sig.Status -ne 'NotSigned') { throw "Signature changed since audit: $($row.Path)" }
        $arguments = @('sign', '/sha1', $CertificateThumbprint, '/s', 'My', '/fd', 'SHA256', '/tr', $TimestampUrl, '/td', 'SHA256')
        if ($StoreLocation -eq 'LocalMachine') { $arguments += '/sm' }
        Invoke-CheckedSignTool $SignTool ($arguments + @($file))
        Invoke-CheckedSignTool $SignTool @('verify', '/pa', '/all', '/v', '/tw', $file)
    }
} finally {
    $after = @(Get-PeSignatureTable $root)
    $after | Export-Csv -LiteralPath (Join-Path $ReportDir 'after.csv') -NoTypeInformation -Encoding UTF8
}
if ($after.Count -ne $before.Count) { throw 'PE file set changed during signing.' }
foreach ($row in $after) {
    $original = @($plan | Where-Object Path -CEQ $row.Path)
    if ($original.Count -ne 1 -or (Get-SigningAction $row @()) -notin 'Preserve', 'VerifyEmbedded') { throw "Final signature invalid: $($row.Path)" }
    if ($original[0].Action -in 'Preserve', 'VerifyEmbedded') {
        if ($row.SHA256 -ne $original[0].SHA256) { throw "Vendor file changed: $($row.Path)" }
    } elseif ($row.Thumbprint -ne $CertificateThumbprint -or -not $row.TimestampSigner) { throw "Signer/timestamp missing or wrong: $($row.Path)" }
    Invoke-CheckedSignTool $SignTool @('verify', '/pa', '/all', '/v', (Join-Path $root $row.Path))
}
Write-Host 'All PE signatures verified. This is not a Smart App Control device acceptance test.'
