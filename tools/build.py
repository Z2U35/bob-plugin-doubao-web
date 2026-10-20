#!/usr/bin/env python3
"""Test and package allowlisted public sources; optionally generate Bob appcast."""
import argparse
import hashlib
import json
import re
import runpy
import subprocess
import time
import zipfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
REPO = "https://github.com/Z2U35/bob-plugin-doubao-web"
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--smoke-report", type=Path)
    parser.add_argument("--helper-http-report", type=Path)
    parser.add_argument("--write-appcast", action="store_true")
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
    smoke = read_report(args.smoke_report)
    http = read_report(args.helper_http_report)
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    version = info["version"]
    base = "DoubaoWebTranslate-" + version
    plugin = output / (base + ".bobplugin")
    entries = {name: (ROOT / "plugin" / name).read_bytes() for name in PLUGIN_FILES}
    for name in ("README.md", "NOTICE.md", "SECURITY.md"):
        entries[name] = (ROOT / name).read_bytes()
    archive(plugin, entries)
    digest = hashlib.sha256(plugin.read_bytes()).hexdigest()
    appcast = ROOT / "appcast.json"
    if args.write_appcast:
        previous = json.loads(appcast.read_text()).get("versions", []) if appcast.exists() else []
        current = {
            "version": version,
            "desc": "测试预览版：新增 macOS 官方网页登录助手、显式本机配对、自动读取登录态；保留手动 Cookie。助手未经过 Apple 公证，真实账号翻译待验证。",
            "sha256": digest,
            "url": REPO + "/releases/download/v" + version + "/" + plugin.name,
            "minBobVersion": info["minBobVersion"],
            "timestamp": int(time.time() * 1000),
        }
        appcast.write_text(json.dumps({
            "identifier": info["identifier"],
            "versions": [current] + [item for item in previous if item["version"] != version]
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    hygiene["check"]()
    source = output / (base + "-source.zip")
    source_entries = {
        base + "-source/" + name: (ROOT / name).read_bytes()
        for name in hygiene["FILES"] if (ROOT / name).exists()
    }
    source_entries[base + "-source/test-results.tap"] = tests.stdout.encode()
    if smoke:
        source_entries[base + "-source/anonymous-smoke.json"] = (json.dumps(smoke, indent=2) + "\n").encode()
    archive(source, source_entries)
    guide = output / "README-安装说明.md"
    guide.write_bytes((ROOT / "README.md").read_bytes())
    native_path = output / "helper-build.json"
    native = json.loads(native_path.read_text()) if native_path.exists() else {}
    if native:
        assert native["version"] == version
    report = output / "TEST-REPORT.md"
    now = datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="seconds")
    network = "未执行"
    if smoke:
        network = f"HTTP {smoke['httpStatus']}，代码 {smoke['upstreamCode']}；匿名测试通过={smoke['passed']}"
    native_text = f"{native['coreChecks']} 项通过；arm64 / x86_64 通用包" if native else "未提供原生构建记录"
    http_text = f"{http['checksPassed']} 项通过；未配对、未提供登录凭证" if http else "未执行"
    report.write_text(
        f"# 测试预览版验证记录\n\n"
        f"- 构建时间：{now}\n"
        f"- 插件版本：{version}；最低 Bob 版本：{info['minBobVersion']}\n"
        f"- JavaScript 语法检查：通过。\n"
        f"- JavaScript 自动化测试：{count}/{count} 通过。\n"
        f"- Swift 原生核心测试：{native_text}。\n"
        f"- 运行中助手 HTTP 安全检查：{http_text}。\n"
        f"- 匿名上游探测：{network}。\n"
        f"- 源码公开检查：显式文件白名单通过；未打包浏览器数据、Cookie、配对文件或截图。\n"
        f"- ZIP 完整性检查通过；插件元数据位于 ZIP 根目录。\n"
        f"- 助手签名：ad-hoc；没有 Developer ID 签名或 Apple 公证。\n\n"
        "## 未完成的真实验收\n\n"
        "- 没有使用真实账号完成扫码登录，不声称登录成功。\n"
        "- 没有在 Bob 原生网络环境下验证账号翻译成功。\n"
        "- 三种翻译后端尚未逐个完成真实账号验证。\n"
        "- 网页登录入口、会话持续时间、风控和服务可用性不受本插件保证。\n\n"
        "本次以测试预览版发布。离线模拟、匿名探测和扫码入口显示都不等同于完整登录翻译验收。\n",
        encoding="utf-8"
    )
    artifacts = [plugin, source, guide, report]
    helper_zip = output / ("DoubaoLoginHelper-" + version + "-macos-universal.zip")
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
