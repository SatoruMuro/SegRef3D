# Shared by packaging and extracted-ZIP verification. Reads headers, not whole CUDA DLLs.
function Assert-WindowsX64Bundle([string]$Root) {
    $files = @(Get-ChildItem -LiteralPath $Root -Recurse -File | Where-Object { $_.Extension.ToLowerInvariant() -in '.exe', '.dll', '.pyd' })
    if ($files.Count -eq 0) { throw 'No PE files found.' }
    foreach ($file in $files) {
        $reader = [IO.BinaryReader]::new([IO.File]::OpenRead($file.FullName))
        try {
            if ($reader.ReadUInt16() -ne 0x5A4D) { throw "Invalid DOS header: $file" }
            $reader.BaseStream.Position = 60
            $peOffset = $reader.ReadUInt32()
            $reader.BaseStream.Position = $peOffset
            if ($reader.ReadUInt32() -ne 0x4550) { throw "Invalid PE signature: $file" }
            $machine = $reader.ReadUInt16()
            if ($machine -ne 0x8664) { throw ('Expected x64 PE; Machine=0x{0:X4}: {1}' -f $machine, $file.FullName) }
            $sections = $reader.ReadUInt16()
            $reader.BaseStream.Position = $peOffset + 20
            $optionalSize = $reader.ReadUInt16()
            $reader.BaseStream.Position = $peOffset + 24
            if ($reader.ReadUInt16() -ne 0x20B -or $optionalSize -lt 200) { throw "Invalid x64 optional header: $file" }
            $reader.BaseStream.Position = $peOffset + 24 + 192
            $configRva = $reader.ReadUInt32()
            $configSize = $reader.ReadUInt32()
            if ($configRva -and $configSize -ge 208) {
                $found = $false
                for ($index = 0; $index -lt $sections; $index++) {
                    $reader.BaseStream.Position = $peOffset + 24 + $optionalSize + 40 * $index + 8
                    $virtualSize = $reader.ReadUInt32()
                    $virtualAddress = $reader.ReadUInt32()
                    $rawSize = $reader.ReadUInt32()
                    $rawOffset = $reader.ReadUInt32()
                    if ($configRva -ge $virtualAddress -and $configRva -lt $virtualAddress + [Math]::Max($virtualSize, $rawSize)) {
                        $reader.BaseStream.Position = $rawOffset + $configRva - $virtualAddress + 200
                        if ($reader.ReadUInt64() -ne 0) { throw "ARM emulation/CHPE binary cannot ship for native x64 Windows: $file" }
                        $found = $true
                        break
                    }
                }
                if (-not $found) { throw "Invalid PE load config: $file" }
            }
        } finally { $reader.Dispose() }
    }
    Write-Host "Validated $($files.Count) native x64 PE files."
    return $files.Count
}
