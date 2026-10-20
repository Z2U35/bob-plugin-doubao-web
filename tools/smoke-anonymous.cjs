"use strict";

var fs = require("node:fs");
var childProcess = require("node:child_process");
var core = require("../plugin/core.js");

function main() {
    var args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--output")) {
        throw new Error("Usage: node tools/smoke-anonymous.cjs [--output report.json]");
    }
    var url = core.makeURL(core.TRANSLATE_PATH, core.randomDevice(), core.randomTab());
    var response = childProcess.execFileSync("curl", [
        "--silent", "--show-error", "--connect-timeout", "10", "--max-time", "35",
        "--request", "POST", url,
        "--header", "Content-Type: application/json",
        "--header", "Accept: text/event-stream",
        "--header", "Origin: " + core.makeHeaders("", true).Origin,
        "--data-binary", JSON.stringify(core.makeBody("Hello, world!", "zh", "1")),
        "--write-out", "\nCODEX_SMOKE_META:%{http_code}:%{content_type}"
    ], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
    var marker = response.lastIndexOf("\nCODEX_SMOKE_META:");
    if (marker < 0) throw new Error("Missing curl status metadata");
    var meta = response.slice(marker + "\nCODEX_SMOKE_META:".length);
    var split = meta.indexOf(":");
    var code = core.responseCode(core.parseJSON(response.slice(0, marker)));
    var mapped = core.toBobError(core.remoteError(code));
    var passed = Number(meta.slice(0, split)) === 200 &&
        ["710012000", "710012001", "710022013"].includes(String(code)) &&
        mapped.type === "secretKey";
    var report = {
        test: "anonymous-upstream",
        observedAt: new Date().toISOString(),
        requestText: "Hello, world!",
        credentialsUsed: false,
        httpStatus: Number(meta.slice(0, split)),
        responseMime: meta.slice(split + 1),
        upstreamCode: /^\d{1,12}$/.test(String(code)) ? String(code) : "unrecognized",
        mappedErrorType: mapped.type,
        passed: passed,
        authenticatedTranslationVerified: false
    };
    if (args.length) fs.writeFileSync(args[1], JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (!passed) process.exitCode = 1;
}

try { main(); } catch (_) {
    console.error("Anonymous smoke test failed. No credentials were supplied or read.");
    process.exitCode = 1;
}
