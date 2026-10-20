"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");
var runner = require("../plugin/runner.js");
var helper = require("../plugin/helper.js");
var messages = require("../plugin/messages.js");
var fake = require("./fake-bob.cjs");

var OPTIONS = { cookie: "sessionid=FAKE_TEST_CREDENTIAL", service: "1" };

async function translate(host, overrides, options) {
    var replies = [];
    var updates = [];
    var query = Object.assign({
        text: "Hello, world!", from: "auto", to: "auto", detectFrom: "en", detectTo: "zh-Hans",
        onCompletion: function (value) { replies.push(value); },
        onStream: function (value) { updates.push(value); }
    }, overrides);
    await runner.translate(host, options || OPTIONS, query);
    return { replies: replies, updates: updates, query: query };
}

test("end-to-end Bob contract: launch, cookies, payload, streaming and 1.21 result", async function () {
    var host = fake.createHost({ body: fake.event("\u4f60\u597d\uff0c\u4e16\u754c\uff01\ud83c\udf0d"), chunkSize: 1 });
    var result = await translate(host);
    assert.equal(host.calls.length, 2);
    var launch = host.calls[0];
    var request = host.calls[1];
    assert.equal(new URL(launch.url).pathname, "/alice/user/launch");
    assert.equal(new URL(request.url).pathname, "/samantha/plugin/stream_article_translate");
    assert.equal(new URL(request.url).searchParams.get("device_id"), "1234567");
    assert.equal(request.header.Cookie, "sessionid=FAKE_TEST_CREDENTIAL; ttwid=fixture");
    assert.equal(request.body.target_lang, "zh");
    assert.deepEqual(request.body.raw_text, ["Hello, world!"]);
    assert.equal(result.replies.length, 1);
    assert.equal(result.updates.length, 1);
    assert.deepEqual(result.replies[0].result, {
        from: "en", to: "zh-Hans", content: { format: "plain", text: "\u4f60\u597d\uff0c\u4e16\u754c\uff01\ud83c\udf0d" }
    });
});

test("each configured provider sends its exact service value", async function () {
    for (var service of ["1", "0", "3"]) {
        var host = fake.createHost();
        var result = await translate(host, {}, { cookie: OPTIONS.cookie, service: service });
        assert.equal(result.replies.length, 1);
        assert.ok(result.replies[0].result);
        assert.equal(host.calls[1].body.translate_service, service);
    }
});

test("optional User-Agent is applied to both requests", async function () {
    var host = fake.createHost();
    await translate(host, {}, Object.assign({}, OPTIONS, { userAgent: "Fixture Browser/1.0" }));
    host.calls.forEach(function (call) { assert.equal(call.header["User-Agent"], "Fixture Browser/1.0"); });
});

test("device cache contains only a public protocol identifier and is reused", async function () {
    var host = fake.createHost();
    await translate(host);
    await translate(host);
    assert.equal(host.writes.length, 1);
    assert.equal(host.writes[0].path, "$sandbox/doubao-web-device.json");
    assert.deepEqual(Object.keys(JSON.parse(host.writes[0].text)), ["schemaVersion", "teaUuid"]);
    assert.equal(host.writes[0].text.includes("FAKE_TEST_CREDENTIAL"), false);
    assert.equal(new URL(host.calls[0].url).searchParams.get("tea_uuid"),
        new URL(host.calls[2].url).searchParams.get("tea_uuid"));
});

test("corrupt or unavailable device cache does not prevent translation", async function () {
    var host = fake.createHost({ files: new Map([["$sandbox/doubao-web-device.json", "bad json"]]) });
    host.file.write = function () { throw new Error("Disk unavailable"); };
    var result = await translate(host);
    assert.ok(result.replies[0].result);
});

test("missing Cookie rejects locally and makes no network requests", async function () {
    var host = fake.createHost();
    var result = await translate(host, {}, { cookie: "", loginMode: "manual" });
    assert.equal(host.calls.length, 0);
    assert.equal(result.replies[0].error.type, "secretKey");
    assert.equal(result.replies[0].error.message, messages.cookieMissing);
    assert.equal(result.replies[0].error.troubleshootingLink, "https://www.doubao.com/");
});

test("unset login mode defaults to manual even when helper pairing exists", async function () {
    for (var mode of [undefined, "", null]) {
        var host = fake.createHost();
        var pairing = JSON.stringify({ version: 1, token: "a".repeat(64) });
        host.files.set(helper.FILE, pairing);
        var result = await translate(host, {}, { loginMode: mode, cookie: "  " });
        assert.equal(host.calls.length, 0);
        assert.equal(result.replies[0].error.message, messages.cookieMissing);
        assert.equal(host.files.get(helper.FILE), pairing);
    }
});

test("fresh validation offers official login guidance without contacting any server", async function () {
    var host = fake.createHost();
    var results = [];
    await runner.validate(host, {}, function (value) { results.push(value); });
    assert.equal(results.length, 1);
    assert.equal(results[0].result, false);
    assert.equal(results[0].error.message, messages.cookieMissing);
    assert.equal(results[0].error.troubleshootingLink, "https://www.doubao.com/");
    assert.equal(host.calls.length, 0);
    assert.equal(host.files.has(helper.FILE), false);
});

test("malformed manual Cookie never falls back to a helper or exposes pasted text", async function () {
    for (var mode of [undefined, "manual", "auto"]) {
        var host = fake.createHost();
        var result = await translate(host, {}, {
            loginMode: mode, cookie: "sessionid=FAKE_PRIVATE\r\nX-Injected: FAKE_SECRET"
        });
        assert.equal(host.calls.length, 0);
        assert.equal(result.replies[0].error.message, messages.cookieFormat);
        assert.equal(result.replies[0].error.troubleshootingLink, "https://www.doubao.com/");
        assert.equal(JSON.stringify(result).includes("FAKE_PRIVATE"), false);
    }
});

test("invalid login mode gives its own local configuration error", async function () {
    var host = fake.createHost();
    var result = await translate(host, {}, { loginMode: "unsupported", cookie: OPTIONS.cookie });
    assert.equal(host.calls.length, 0);
    assert.equal(result.replies[0].error.type, "param");
    assert.equal(result.replies[0].error.message, messages.loginMode);
});

test("invalid target and oversized text reject before sending credentials", async function () {
    for (var query of [{ to: "yue" }, { text: "a".repeat(12001) }]) {
        var host = fake.createHost();
        var result = await translate(host, query);
        assert.ok(result.replies[0].error);
        assert.equal(host.calls.length, 0);
    }
});

test("startup is best-effort; translation can proceed after launch network failure", async function () {
    var host = fake.createHost({
        request: function (options) { options.handler({ error: { message: "secret debug details" } }); }
    });
    var result = await translate(host);
    assert.ok(result.replies[0].result);
    assert.equal(host.calls[1].header.Cookie, OPTIONS.cookie);
    assert.equal(new URL(host.calls[1].url).searchParams.get("device_id"), "0");
});

test("anonymous JSON login error becomes a useful redacted Bob error", async function () {
    var host = fake.createHost({
        mime: "application/json; charset=utf-8",
        body: JSON.stringify({ code: 710012001, msg: "DO_NOT_EXPOSE_COOKIE", error: { code: 710012001 } })
    });
    var result = await translate(host);
    assert.equal(result.replies[0].error.type, "secretKey");
    assert.match(result.replies[0].error.message, /710012001/);
    assert.equal(JSON.stringify(result).includes("DO_NOT_EXPOSE_COOKIE"), false);
    assert.equal(result.replies[0].error.troubleshootingLink, "https://www.doubao.com/");
});

test("SSE auth errors survive the transport cancellation used to stop the stream", async function () {
    var host = fake.createHost({ body: "event: err\ndata: {\"code\":710012001}\n\n" });
    var result = await translate(host);
    assert.equal(result.replies.length, 1);
    assert.equal(result.replies[0].error.type, "secretKey");
});

test("done-driven transport cancellation is not presented as an error", async function () {
    var host = fake.createHost({ noResponseOnCancel: true });
    var result = await translate(host);
    assert.ok(result.replies[0].result);
});

test("HTTP failures remain failures even if the body resembles a valid SSE event", async function () {
    for (var status of [401, 403, 429, 503]) {
        var result = await translate(fake.createHost({ status: status }));
        assert.ok(result.replies[0].error);
        assert.equal(result.replies.length, 1);
    }
});

test("malformed SSE returns an error rather than a partial success", async function () {
    var result = await translate(fake.createHost({ body: "event: json\ndata: invalid\n\n" }));
    assert.ok(result.replies[0].error);
    assert.equal(result.updates.length, 0);
});

test("HTML login or verification pages do not become translation output", async function () {
    var result = await translate(fake.createHost({ mime: "text/html", body: "<html>verification</html>" }));
    assert.ok(result.replies[0].error);
    assert.equal(result.updates.length, 0);
});

test("UTF-8 truncation is surfaced as a safe error", async function () {
    var host = fake.createHost({
        stream: function (options) {
            options.streamHandler({ rawData: fake.data(Buffer.from([0xe4, 0xbd])) });
            options.handler({ response: { statusCode: 200, MIMEType: "text/event-stream" } });
        }
    });
    var result = await translate(host);
    assert.ok(result.replies[0].error);
});

test("a connection failure with private diagnostics never leaks those diagnostics", async function () {
    var result = await translate(fake.createHost({
        body: "", error: { message: "sessionid=PRIVATE" }
    }));
    assert.equal(result.replies[0].error.type, "network");
    assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
});

test("cancelling during launch prevents a later translation request", async function () {
    var cancel = fake.signal();
    var host = fake.createHost({
        request: function (options) {
            cancel.send();
            options.handler({ error: { message: "cancelled" } });
        }
    });
    var result = await translate(host, { cancelSignal: cancel });
    assert.ok(result.replies[0].error);
    assert.equal(host.calls.length, 1);
    assert.equal(cancel.size(), 0);
});

test("cancelling during streaming returns exactly once and removes subscription", async function () {
    var cancel = fake.signal();
    var host = fake.createHost({ afterChunk: function () { cancel.send(); } });
    var result = await translate(host, { cancelSignal: cancel });
    assert.equal(result.replies.length, 1);
    assert.ok(result.replies[0].error);
    assert.equal(result.updates.length, 0);
    assert.equal(cancel.size(), 0);
});

test("parallel requests do not exchange credentials or selected providers", async function () {
    var host = fake.createHost();
    var results = await Promise.all([
        translate(host, {}, { cookie: "sessionid=FAKE_A", service: "0" }),
        translate(host, {}, { cookie: "sessionid=FAKE_B", service: "3" })
    ]);
    results.forEach(function (value) { assert.ok(value.replies[0].result); });
    var requests = host.calls.filter(function (call) { return !!call.body; });
    assert.equal(requests[0].header.Cookie, "sessionid=FAKE_A; ttwid=fixture");
    assert.equal(requests[0].body.translate_service, "0");
    assert.equal(requests[1].header.Cookie, "sessionid=FAKE_B; ttwid=fixture");
    assert.equal(requests[1].body.translate_service, "3");
});

test("non-Doubao response origins are rejected", async function () {
    var result = await translate(fake.createHost({ responseURL: "https://www.doubao.com.evil.example/" }));
    assert.equal(result.replies[0].error.type, "network");
});

test("validation performs an actual test translation", async function () {
    var host = fake.createHost();
    var results = [];
    await runner.validate(host, OPTIONS, function (value) { results.push(value); });
    assert.deepEqual(results, [{ result: true }]);
    assert.deepEqual(host.calls[1].body.raw_text, ["Hello, world!"]);
});

test("validation does not claim success for expired credentials", async function () {
    var host = fake.createHost({ mime: "application/json", body: '{"code":710012001}' });
    var results = [];
    await runner.validate(host, OPTIONS, function (value) { results.push(value); });
    assert.equal(results[0].result, false);
    assert.equal(results[0].error.type, "secretKey");
});

test("expired pasted Cookie requires manual renewal and never switches accounts via the helper", async function () {
    for (var mode of [undefined, "manual", "auto"]) {
        var host = fake.createHost({ mime: "application/json", body: '{"code":710012001}' });
        var pairing = JSON.stringify({ version: 1, token: "a".repeat(64) });
        host.files.set(helper.FILE, pairing);
        var result = await translate(host, {}, { loginMode: mode, cookie: OPTIONS.cookie });
        assert.equal(host.calls.length, 2);
        assert.ok(host.calls.every(function (call) { return new URL(call.url).origin === "https://www.doubao.com"; }));
        assert.equal(result.replies[0].error.message, messages.login + " (710012001)");
        assert.equal(result.replies[0].error.troubleshootingLink, "https://www.doubao.com/");
        assert.equal(host.files.get(helper.FILE), pairing);
    }
});

test("legacy completion fallback still works", async function () {
    var results = [];
    await runner.translate(fake.createHost(), OPTIONS, { text: "Hello", from: "en", to: "zh-Hans" },
        function (value) { results.push(value); });
    assert.equal(results.length, 1);
    assert.ok(results[0].result);
});

test("main.js loads with only documented Bob globals and local modules", async function () {
    var host = fake.createHost();
    var root = path.resolve(__dirname, "../plugin");
    var modules = new Map();
    var globals = {
        $http: host.http, $data: host.data, $file: host.file,
        $signal: host.signal, $option: OPTIONS
    };
    function load(name) {
        var filename = path.resolve(root, name);
        assert.ok(filename.startsWith(root + path.sep));
        if (modules.has(filename)) return modules.get(filename);
        var exports = {};
        var context = vm.createContext(Object.assign({}, globals, {
            module: { exports: exports }, exports: exports,
            require: function (relative) { return load(relative); }
        }));
        vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename: filename });
        modules.set(filename, context.module.exports);
        return context.module.exports;
    }
    var main = load("./main.js");
    assert.equal(main.pluginTimeoutInterval(), 120);
    assert.ok(main.supportLanguages().includes("zh-Hans"));
    var results = [];
    await main.translate({
        text: "Hello", from: "en", to: "zh-Hans",
        onCompletion: function (value) { results.push(value); }
    });
    assert.equal(results.length, 1);
    assert.ok(results[0].result);
});

test("metadata is valid and credentials have an empty secure input", function () {
    var info = JSON.parse(fs.readFileSync(path.join(__dirname, "../plugin/info.json"), "utf8"));
    assert.match(info.identifier, /^[a-z0-9.]+$/);
    assert.match(info.version, /^[a-z0-9.]+$/);
    assert.equal(info.minBobVersion, "1.21.0");
    assert.equal(info.category, "translate");
    assert.equal(info.appcast, "https://raw.githubusercontent.com/Z2U35/bob-plugin-doubao-web/main/appcast.json");
    var cookie = info.options.find(function (option) { return option.identifier === "cookie"; });
    assert.equal(cookie.defaultValue, "");
    assert.equal(cookie.textConfig.type, "secure");
    var mode = info.options.find(function (option) { return option.identifier === "loginMode"; });
    assert.equal(mode.defaultValue, "manual");
    assert.deepEqual(mode.menuValues.map(function (item) { return item.value; }), ["manual", "helper", "auto"]);
});
