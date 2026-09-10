"""Remove collected test/cache artifacts and add the explicitly shipped support files."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shutil
import subprocess

APP_ROOT = Path(__file__).resolve().parents[1]
NON_RUNTIME_DIRS = {"tests", "test", "__pycache__", ".pytest_cache", ".git"}
NON_RUNTIME_SUFFIXES = {".pyc", ".pyo", ".pdb", ".dmp", ".ipynb"}


def prepare(root):
    root = Path(root).resolve(strict=True)
    internal = root / "_internal"
    if not (root / "SegRef3D.exe").is_file() or not internal.is_dir():
        raise ValueError("Expected a completed SegRef3D one-folder distribution")
    # Check the complete tree before deleting anything; never follow external links.
    entries = list(internal.rglob("*"))
    for entry in entries:
        entry.resolve().relative_to(root)
        if entry.is_symlink() or entry.is_junction():
            raise ValueError(f"Linked distribution entry: {entry}")
    removed = 0
    for entry in sorted(entries, key=lambda p: len(p.parts), reverse=True):
        if not entry.exists():
            continue
        # Preserve vendor license trees, including license paths named 'test'.
        relative = entry.relative_to(internal)
        if any(part.endswith(".dist-info") for part in relative.parts):
            continue
        if entry.is_dir() and entry.name in NON_RUNTIME_DIRS:
            shutil.rmtree(entry)
            removed += 1
        elif entry.is_file() and (entry.suffix.lower() in NON_RUNTIME_SUFFIXES or entry.name.startswith("test_") or entry.name.endswith("_test.py")):
            entry.unlink()
            removed += 1
    for name in ("audit_windows_signatures.ps1", "sign_windows_release.ps1", "windows_signing_common.ps1", "windows_signing_approvals.json", "verify_windows_release.ps1", "check_windows_x64.ps1"):
        destination = root / "scripts" / name
        destination.parent.mkdir(exist_ok=True)
        shutil.copy2(APP_ROOT / "scripts" / name, destination)
    (root / "docs").mkdir(exist_ok=True)
    shutil.copy2(APP_ROOT / "docs/WINDOWS_SIGNING.md", root / "docs/WINDOWS_SIGNING.md")
    shutil.copy2(APP_ROOT / "docs/WINDOWS_RELEASE_README.md", root / "README.md")
    shutil.copy2(APP_ROOT.parent / "LICENSE", root / "LICENSE")
    source = (APP_ROOT / "SegRef3D.py").read_text("utf-8")
    version = re.search(r'^__version__ = "([^"]+)"', source).group(1)
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=APP_ROOT, text=True).strip()
    info = {"product": "SegRef3D Local GPU", "version": version, "sourceCommit": commit,
            "builtAtUtc": datetime.now(timezone.utc).isoformat(), "signingStatus": "not-yet-audited"}
    (root / "release-info.json").write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
    print(f"Removed {removed} test/cache/debug entries; added release support files.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("dist", type=Path)
    prepare(parser.parse_args().dist)
