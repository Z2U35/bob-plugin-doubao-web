#!/usr/bin/env python3
"""Test and package the Bob plugin and allowlisted sources."""
import argparse
import hashlib
import json
import plistlib
import re
import runpy
import subprocess
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
STAMP = (2026, 10, 20, 0, 0, 0)
PLUGIN_FILES = ["info.json", "main.js", "core.js", "runner.js", "messages.js", "helper.js"]


def archive(path, entries):
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as output:
        for name, data in sorted(entries.items()):
            info = zipfile.ZipInfo(name, STAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            output.writestr(info, data)
    with zipfile.ZipFile(path) as output:
        assert output.testzip() is None


def read_report(path):
    if not path:
        return None
    data = json.loads(path.read_text())
    assert data.get("credentialsUsed") is False
    return data


def test_helper_core():
    with tempfile.TemporaryDirectory(prefix="doubao-helper-tests-") as directory:
        binary = Path(directory) / "helper-tests"
        subprocess.run([
            "xcrun", "swiftc", "-swift-version", "5",
            str(ROOT / "helper/BridgeCore.swift"), str(ROOT / "helper/tests/CoreTests.swift"),
            "-o", str(binary)
        ], check=True)
        result = subprocess.run([str(binary)], check=True, text=True, capture_output=True)
        return int(re.search(r"(\d+) checks passed", result.stdout).group(1))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--smoke-report", type=Path)
    parser.add_argument("--helper-http-report", type=Path)
    parser.add_argument("--test-helper", action="store_true", help="Run synthetic Swift core tests without opening the helper")
    args = parser.parse_args()
    hygiene = runpy.run_path(str(ROOT / "tools/check-public-tree.py"))
    hygiene["check"]()
    info = json.loads((ROOT / "plugin/info.json").read_text())
    for filename in PLUGIN_FILES:
        if filename.endswith(".js"):
            subprocess.run(["node", "--check", str(ROOT / "plugin" / filename)], check=True)
    tests = subprocess.run(
        ["node", "--test", "--test-reporter=tap", *map(str, sorted((ROOT / "tests").glob("*.test.cjs")))],
        cwd=ROOT, text=True, capture_output=True
    )
    if tests.returncode:
        print(tests.stdout)
        print(tests.stderr)
        raise SystemExit(tests.returncode)
    count = int(re.search(r"^# tests (\d+)$", tests.stdout, re.M).group(1))
    helper_checks = test_helper_core() if args.test_helper else None
    helper_info = plistlib.loads((ROOT / "helper/Info.plist").read_bytes())
    helper_version = helper_info["CFBundleShortVersionString"]
    smoke = read_report(args.smoke_report)
    http = read_report(args.helper_http_report)
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    version = info["version"]
    base = "DoubaoWebTranslate-" + version
    plugin = output / (base + ".bobplugin")
    entries = {name: (ROOT / "plugin" / name).read_bytes() for name in PLUGIN_FILES}
    for name in ("README.md", "LICENSE"):
        entries[name] = (ROOT / name).read_bytes()
    archive(plugin, entries)
    hygiene["check"]()
    source = output / (base + "-source.zip")
    source_entries = {
        base + "-source/" + name: (ROOT / name).read_bytes()
        for name in hygiene["FILES"] if (ROOT / name).exists()
    }
    source_entries[base + "-source/test-results.tap"] = tests.stdout.encode()
    if helper_checks is not None:
        source_entries[base + "-source/helper-core-tests.txt"] = (
            f"Helper {helper_version} core: {helper_checks} synthetic checks passed\n"
        ).encode()
    if smoke:
        source_entries[base + "-source/anonymous-smoke.json"] = (json.dumps(smoke, indent=2) + "\n").encode()
    archive(source, source_entries)
    guide = output / "INSTALL.md"
    guide.write_bytes((ROOT / "README.md").read_bytes())
    native_path = output / "helper-build.json"
    native = json.loads(native_path.read_text()) if native_path.exists() else {}
    if native:
        assert native["version"] == helper_version
    report = output / "TEST-REPORT.md"
    now = datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="seconds")
    network = "未执行"
    if smoke:
        network = f"HTTP {smoke['httpStatus']}，代码 {smoke['upstreamCode']}；匿名测试通过={smoke['passed']}"
    if helper_checks is not None:
        native_text = f"{helper_checks} 项通过；助手 {helper_version}，仅使用合成凭证"
    elif native:
        native_text = f"{native['coreChecks']} 项通过（来自助手 {helper_version} 构建记录）"
    else:
        native_text = "未执行，也未提供原生构建记录"
    http_text = f"{http['checksPassed']} 项通过；未配对、未提供登录凭证" if http else "未执行"
    report.write_text(
        f"# 测试预览版验证记录\n\n"
        f"- 构建时间：{now}\n"
        f"- 插件版本：{version}；最低 Bob 版本：{info['minBobVersion']}\n"
        f"- 默认登录方式：手动 Cookie；原有 {helper_version} 登录助手保留为备选。\n"
        f"- JavaScript 语法检查：通过。\n"
        f"- JavaScript 自动化测试：{count}/{count} 通过。\n"
        f"- Swift 原生核心测试：{native_text}。\n"
        f"- 运行中助手 HTTP 安全检查：{http_text}。\n"
        f"- 匿名上游探测：{network}。\n"
        f"- 源码公开检查：显式文件白名单通过；未打包浏览器数据、Cookie、配对文件或截图。\n"
        f"- ZIP 完整性检查通过；插件元数据位于 ZIP 根目录。\n"
        f"- 助手签名：ad-hoc；没有 Developer ID 签名或 Apple 公证。\n\n"
        "## 待验证\n\n"
        "- 真实账号在 Bob 内的登录、翻译及三种翻译后端。\n",
        encoding="utf-8"
    )
    artifacts = [plugin, source, guide, report]
    helper_zip = output / ("DoubaoLoginHelper-" + helper_version + "-macos-universal.zip")
    if helper_zip.exists():
        assert hashlib.sha256(helper_zip.read_bytes()).hexdigest() == native["sha256"]
        artifacts.append(helper_zip)
    if native_path.exists():
        artifacts.append(native_path)
    sums = [f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}" for path in artifacts]
    (output / "SHA256SUMS.txt").write_text("\n".join(sums) + "\n")
    print(f"{count} JavaScript tests passed. Artifacts and ZIPs verified.")
    for path in artifacts:
        print(f"{path.name}: {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
