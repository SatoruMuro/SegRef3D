# Run with powershell -NoProfile -File tests/test_windows_signing.ps1
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../scripts/windows_signing_common.ps1"
function Assert-Equal($actual, $expected) {
    if ($actual -cne $expected) { throw "Expected '$expected', got '$actual'." }
}
$row = [pscustomobject]@{ Path = '_internal/vtkmodules/test.pyd'; SHA256 = ('A' * 64); Status = 'NotSigned'; EmbeddedSignature = $false; SignatureType = 'None'; PublicKeyOid = ''; EmbeddedPublicKeyOid = '' }
Assert-Equal (Get-SigningAction $row @()) 'NeedsReview'
$approval = [pscustomobject]@{ Path = $row.Path; SHA256 = $row.SHA256; Package = 'fixture'; License = 'BSD-3-Clause'; Source = 'https://example.invalid/test'; Review = 'Test data only' }
Assert-Equal (Get-SigningAction $row @($approval)) 'SignReviewedDependency'
$approval.SHA256 = 'B' * 64
Assert-Equal (Get-SigningAction $row @($approval)) 'NeedsReview'
$approval.Path = '*'
Assert-Equal (Get-SigningAction $row @($approval)) 'NeedsReview'
$row.Path = 'SegRef3D.exe'
Assert-Equal (Get-SigningAction $row @()) 'SignApp'
foreach ($status in 'UnknownError', 'HashMismatch', 'NotTrusted', 'NotSupported') {
    $row.Status = $status
    Assert-Equal (Get-SigningAction $row @()) 'BlockedSignature'
}
$row.Status = 'NotSigned'
$row.EmbeddedSignature = $true
Assert-Equal (Get-SigningAction $row @()) 'BlockedSignature'
$row.Status = 'Valid'
$row.SignatureType = 'Authenticode'
$row.PublicKeyOid = '1.2.840.113549.1.1.1'
Assert-Equal (Get-SigningAction $row @()) 'Preserve'
$row.SignatureType = 'Catalog'
Assert-Equal (Get-SigningAction $row @()) 'BlockedSignature'
$row.EmbeddedPublicKeyOid = '1.2.840.113549.1.1.1'
Assert-Equal (Get-SigningAction $row @()) 'VerifyEmbedded'
$row.SignatureType = 'Authenticode'
$row.PublicKeyOid = '1.2.840.10045.2.1'
Assert-Equal (Get-SigningAction $row @()) 'BlockedSignature'
Write-Host 'Signing policy: 14 cases passed (no certificates or signatures generated).'
