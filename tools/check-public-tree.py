#!/usr/bin/env python3
"""Fail before publication if the allowlisted source contains private artifacts."""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    ".gitignore", ".github/workflows/test.yml",
    "README.md", "DEVELOPMENT.md", "NOTICE.md", "SECURITY.md", "CHANGELOG.md", "LICENSE",
    "appcast.json",
    "plugin/info.json", "plugin/main.js", "plugin/core.js", "plugin/helper.js",
    "plugin/runner.js", "plugin/messages.js",
    "tests/core.test.cjs", "tests/runner.test.cjs", "tests/helper.test.cjs", "tests/fake-bob.cjs",
    "helper/BridgeCore.swift", "helper/LoopbackServer.swift", "helper/main.swift", "helper/Info.plist",
    "helper/tests/CoreTests.swift",
    "tools/build.py", "tools/build-helper.py", "tools/smoke-anonymous.cjs",
    "tools/check-helper-http.py", "tools/check-public-tree.py"
]


def check():
    for name in FILES:
        file = ROOT / name
        if name == "appcast.json" and not file.exists():
            continue
        data = file.read_text(encoding="utf-8")
        if name != "tools/check-public-tree.py":
            assert not re.search(r"/Users/[^/\s]+/", data), f"Private filesystem path: {name}"
            assert not re.search(r"(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}", data), f"GitHub token: {name}"
            for match in re.finditer(r"sessionid=([A-Za-z0-9%_+=/-]{16,})", data):
                assert match.group(1).startswith(("FAKE_", "SYNTHETIC_")), f"Possible session credential: {name}"
    info = json.loads((ROOT / "plugin/info.json").read_text())
    assert info["identifier"] == "com.z2u35.bob.doubaoweb"
    for option in info["options"]:
        if option["identifier"] in ("cookie", "userAgent"):
            assert option.get("defaultValue", "") == ""
    if (ROOT / ".git").exists():
        tracked = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True).stdout
        unknown = set(tracked.decode().strip("\0").split("\0")) - set(FILES) - {""}
        assert not unknown, "Unexpected tracked files outside the public allowlist"
    print(f"Public source allowlist checked: {len(FILES)} files; no embedded account values.")


if __name__ == "__main__":
    check()
