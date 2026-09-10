"""Extract pinned Microsoft x64 redistributables without installing them.

Input: https://aka.ms/vs/18/release/14.50.35719/VC_redist.x64.exe
The installer also contains ARM64 payloads. Select only the amd64 minimum CAB.
Never collect runtime DLLs from this build machine's System32 directory.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import xml.etree.ElementTree as ET

from windows_pe import require_x64

REDIST_SHA256 = '8995548dfffcde7c49987029c764355612ba6850ee09a7b6f0fddc85bdc5c280'
REDIST_URL = 'https://aka.ms/vs/18/release/14.50.35719/VC_redist.x64.exe'
NS = {'b': 'http://schemas.microsoft.com/wix/2008/Burn'}


def stage(installer: Path, destination: Path) -> None:
    data = installer.read_bytes()
    if hashlib.sha256(data).hexdigest() != REDIST_SHA256:
        raise RuntimeError('Unexpected VC redistributable SHA-256; use the pinned official 14.50.35719 x64 package.')
    # Burn v3 containers in this hash-pinned, Microsoft-signed installer.
    cabinets = []
    offset = 0
    while (offset := data.find(b'MSCF\0\0\0\0', offset)) >= 0:
        size = struct.unpack_from('<I', data, offset + 8)[0]
        if size < 36 or offset + size > len(data):
            raise RuntimeError('Invalid cabinet bounds')
        cabinets.append(data[offset:offset + size])
        offset += size
    if len(cabinets) != 2:
        raise RuntimeError('Unexpected redistributable container layout')
    destination.mkdir(parents=True, exist_ok=True)
    if any(destination.iterdir()):
        raise RuntimeError(f'Use an empty MSVC staging directory: {destination}')
    with tempfile.TemporaryDirectory(prefix='msvc-', dir=destination.parent) as temp:
        temp = Path(temp)
        folders = []
        for index, cabinet in enumerate(cabinets):
            cab = temp / f'{index}.cab'
            cab.write_bytes(cabinet)
            folder = temp / str(index)
            folder.mkdir()
            subprocess.run(['expand.exe', str(cab), '-F:*', str(folder)], check=True, capture_output=True)
            folders.append(folder)
        manifest = ET.parse(folders[0] / '0')
        payload = next(p for p in manifest.findall('b:Payload', NS)
                       if p.attrib['FilePath'] == r'packages\vcRuntimeMinimum_amd64\cab1.cab')
        cab = folders[1] / payload.attrib['SourcePath']
        if hashlib.sha1(cab.read_bytes()).hexdigest().upper() != payload.attrib['Hash']:
            raise RuntimeError('Redistributable CAB does not match its manifest')
        dlls = temp / 'dlls'
        dlls.mkdir()
        subprocess.run(['expand.exe', str(cab), '-F:*', str(dlls)], check=True, capture_output=True)
        records = []
        for source in sorted(dlls.glob('*.dll_amd64')):
            require_x64(source)
            name = source.name.removesuffix('_amd64')
            shutil.copyfile(source, destination / name)
            records.append(dict(name=name, sha256=hashlib.sha256(source.read_bytes()).hexdigest(), machine='0x8664'))
        if len(records) != 12:
            raise RuntimeError('Expected 12 native x64 minimum-runtime DLLs')
    (destination / 'msvc-runtime-provenance.json').write_text(json.dumps(dict(
        source=REDIST_URL, installerSHA256=REDIST_SHA256, version='14.50.35719.0',
        payload=payload.attrib['FilePath'], files=records), indent=2), encoding='utf-8')
    print(f'[MSVC] Staged {len(records)} verified x64 runtime DLLs from pinned Microsoft redistributable.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('installer', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    stage(args.installer.resolve(), args.destination.resolve())
