#!/usr/bin/env python3
"""Build and ad-hoc sign the macOS helper, without account data or notarization."""
import argparse
import hashlib
import json
import plistlib
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(*args, capture=False):
    return subprocess.run(list(map(str, args)), check=True, text=True, capture_output=capture)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--build-dir", required=True, type=Path)
    parser.add_argument("--replace", action="store_true", help="Move an earlier build aside before replacing it")
    args = parser.parse_args()
    args.build_dir.mkdir(parents=True, exist_ok=True)
    build = Path(tempfile.mkdtemp(prefix="helper-build-", dir=args.build_dir.resolve()))
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    info = plistlib.loads((ROOT / "helper/Info.plist").read_bytes())
    version = info["CFBundleShortVersionString"]
    sources = [ROOT / "helper" / name for name in ("BridgeCore.swift", "LoopbackServer.swift", "main.swift")]
    tests = build / "helper-core-tests"
    run("xcrun", "swiftc", "-swift-version", "5", ROOT / "helper/BridgeCore.swift",
        ROOT / "helper/tests/CoreTests.swift", "-o", tests)
    test_text = run(tests, capture=True).stdout.strip()
    print(test_text, flush=True)
    binaries = []
    for arch in ("arm64", "x86_64"):
        binary = build / ("helper-" + arch)
        run("xcrun", "swiftc", "-swift-version", "5", "-O", "-target", arch + "-apple-macos13.0",
            "-framework", "AppKit", "-framework", "WebKit", "-framework", "Network",
            "-framework", "Security", *sources, "-o", binary)
        binaries.append(binary)
    app = output / "Doubao Login Helper.app"
    if app.exists():
        if not args.replace:
            raise SystemExit("Output app already exists; choose a new output directory or --replace.")
        shutil.move(str(app), str(build / app.name))
    executable = app / "Contents/MacOS/DoubaoLoginHelper"
    executable.parent.mkdir(parents=True)
    shutil.copyfile(ROOT / "helper/Info.plist", app / "Contents/Info.plist")
    run("xcrun", "lipo", "-create", *binaries, "-output", executable)
    executable.chmod(0o755)
    run("codesign", "--force", "--sign", "-", "--timestamp=none", app)
    run("codesign", "--verify", "--deep", "--strict", app)
    actual = run(executable, "--version", capture=True).stdout.strip()
    if actual != "Doubao Login Helper " + version:
        raise RuntimeError("Helper executable version mismatch")
    archive = output / ("DoubaoLoginHelper-" + version + "-macos-universal.zip")
    run("ditto", "-c", "-k", "--keepParent", "--sequesterRsrc", app, archive)
    report = {
        "version": version,
        "architectures": ["arm64", "x86_64"],
        "minimumMacOS": "13.0",
        "signature": "ad-hoc",
        "notarized": False,
        "coreChecks": int(re.search(r"(\d+) checks passed", test_text).group(1)),
        "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "authenticatedLoginVerified": False,
    }
    (output / "helper-build.json").write_text(json.dumps(report, indent=2) + "\n")
    print(archive.name + ": " + report["sha256"], flush=True)


if __name__ == "__main__":
    main()
