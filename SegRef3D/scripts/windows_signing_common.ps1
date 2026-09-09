Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PeSignatureTable {
    param([Parameter(Mandatory)][string]$DistDir)
    $root = (Resolve-Path -LiteralPath $DistDir).Path.TrimEnd('\', '/')
    if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Distribution root must not be a reparse point.'
    }
    $entries = @(Get-ChildItem -LiteralPath $root -Recurse -Force)
    if ($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) {
        throw 'Distribution must not contain symlinks or junctions.'
    }
    foreach ($file in $entries | Where-Object { -not $_.PSIsContainer -and $_.Extension -in '.exe', '.dll', '.pyd' } | Sort-Object FullName) {
        $stream = [IO.File]::OpenRead($file.FullName)
        $reader = [IO.BinaryReader]::new($stream)
        try {
            if ($stream.Length -lt 64 -or $reader.ReadUInt16() -ne 0x5a4d) { throw "Not a PE: $($file.FullName)" }
            $stream.Position = 0x3c
            $offset = $reader.ReadUInt32()
            if ($offset + 152 -gt $stream.Length) { throw 'Truncated PE header.' }
            $stream.Position = $offset
            if ($reader.ReadUInt32() -ne 0x4550) { throw 'Invalid PE signature.' }
            $stream.Position = $offset + 24
            $magic = $reader.ReadUInt16()
            $directoryOffset = switch ($magic) { 0x10b { 96 }; 0x20b { 112 }; default { throw 'Unsupported PE format.' } }
            $stream.Position = $offset + 24 + $directoryOffset + 32
            $certOffset = $reader.ReadUInt32()
            $certSize = $reader.ReadUInt32()
        } finally { $reader.Dispose(); $stream.Dispose() }
        $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
        $signer = $signature.SignerCertificate
        $timestamp = $signature.TimeStamperCertificate
        $embeddedSigner = ''
        $embeddedKeyOid = ''
        $embeddedReadError = ''
        if ($certOffset -ne 0 -and $certSize -ne 0) {
            $embedded = $null
            $rawCertificate = $null
            try {
                # Metadata only. SignTool /pa /all (without /a) MUST separately
                # verify the embedded signature before any release is accepted.
                $rawCertificate = [Security.Cryptography.X509Certificates.X509Certificate]::CreateFromSignedFile($file.FullName)
                $embedded = [Security.Cryptography.X509Certificates.X509Certificate2]::new($rawCertificate)
                $embeddedSigner = $embedded.Subject
                $embeddedKeyOid = $embedded.PublicKey.Oid.Value
            } catch {
                $embeddedReadError = $_.Exception.Message
            } finally {
                if ($embedded) { $embedded.Dispose() }
                if ($rawCertificate) { $rawCertificate.Dispose() }
            }
        }
        [pscustomobject]@{
            Path = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
            Extension = $file.Extension.ToLowerInvariant()
            SHA256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
            Status = [string]$signature.Status
            StatusMessage = $signature.StatusMessage
            SignatureType = [string]$signature.SignatureType
            EmbeddedSignature = ($certOffset -ne 0 -or $certSize -ne 0)
            Signer = $(if ($signer) { $signer.Subject } else { '' })
            Thumbprint = $(if ($signer) { $signer.Thumbprint } else { '' })
            PublicKeyOid = $(if ($signer) { $signer.PublicKey.Oid.Value } else { '' })
            EmbeddedSigner = $embeddedSigner
            EmbeddedPublicKeyOid = $embeddedKeyOid
            EmbeddedReadError = $embeddedReadError
            TimestampSigner = $(if ($timestamp) { $timestamp.Subject } else { '' })
            TimestampThumbprint = $(if ($timestamp) { $timestamp.Thumbprint } else { '' })
        }
    }
}

function Get-SigningAction {
    param($Row, [array]$Approvals)
    # Even an invalid or unrecognized existing signature must never be replaced.
    if ($Row.Status -eq 'Valid' -and $Row.EmbeddedSignature -and $Row.SignatureType -eq 'Authenticode' -and $Row.PublicKeyOid -eq '1.2.840.113549.1.1.1') { return 'Preserve' }
    if ($Row.Status -eq 'Valid' -and $Row.EmbeddedSignature -and $Row.SignatureType -eq 'Catalog' -and $Row.EmbeddedPublicKeyOid -eq '1.2.840.113549.1.1.1') { return 'VerifyEmbedded' }
    if ($Row.Status -ne 'NotSigned' -or $Row.EmbeddedSignature) { return 'BlockedSignature' }
    if ($Row.Path -ceq 'SegRef3D.exe') { return 'SignApp' }
    $matches = @($Approvals | Where-Object { $_.Path -ceq $Row.Path -and $_.SHA256 -eq $Row.SHA256 })
    if ($matches.Count -eq 1) {
        foreach ($field in 'Package', 'License', 'Source', 'Review') {
            if ([string]::IsNullOrWhiteSpace($matches[0].$field)) { return 'NeedsReview' }
        }
        return 'SignReviewedDependency'
    }
    return 'NeedsReview'
}

function Invoke-CheckedSignTool {
    param([string]$Tool, [string[]]$Arguments)
    & $Tool @Arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "SignTool failed or warned (exit $LASTEXITCODE)." }
}
