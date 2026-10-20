"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var helper = require("../plugin/helper.js");
var core = require("../plugin/core.js");
var runner = require("../plugin/runner.js");
var messages = require("../plugin/messages.js");
var fake = require("./fake-bob.cjs");
var token = "a".repeat(64);
var requestId = "b".repeat(64);
var code = "123456";

function hostWith(responses, saved) {
    var host = fake.createHost();
    var original = host.http.request;
    if (saved) host.files.set(helper.FILE, JSON.stringify(Object.assign({ version: 1 }, saved)));
    host.http.request = function (options) {
        if (!options.url.startsWith(helper.BASE)) return original(options);
        host.calls.push(options);
        var value = responses.shift();
        assert.ok(value, "unexpected helper request");
        if (value.error) return options.handler({ error: { message: "DO_NOT_LOG_PRIVATE" } });
        options.handler({
            data: value.data,
            response: { statusCode: value.status, url: options.url }
        });
    };
    return host;
}

function context() { return { cancelled: false, signal: fake.signal() }; }

test("first pairing stores only the ephemeral request identifier and displays a matching code", async function () {
    var host = hostWith([{ status: 202, data: { requestId: requestId, code: code } }]);
    await assert.rejects(helper.credentials(host, "123456789123456789", context()), function (error) {
        return error.message.includes(code);
    });
    var saved = JSON.parse(host.files.get(helper.FILE));
    assert.equal(saved.requestId, requestId);
    assert.equal(saved.token, undefined);
    assert.equal(host.calls[0].header["X-Doubao-Bob-Client"], "bob-plugin-v1");
    assert.equal(host.calls[0].header.Authorization, undefined);
});

test("approved pairing automatically stores the bridge token and fetches the session", async function () {
    var host = hostWith([
        { status: 200, data: { token: token } },
        { status: 200, data: { cookie: "sessionid=FAKE_COOKIE", userAgent: "Fixture Browser/2" } }
    ], { requestId: requestId, code: code });
    var credentials = await helper.credentials(host, "123456789123456789", context());
    assert.equal(credentials.cookie, "sessionid=FAKE_COOKIE");
    assert.equal(credentials.userAgent, "Fixture Browser/2");
    assert.equal(JSON.parse(host.files.get(helper.FILE)).token, token);
    assert.equal(host.files.get(helper.FILE).includes("FAKE_COOKIE"), false);
    assert.equal(host.calls[1].header.Authorization, "Bearer " + token);
});

test("pending pairing does not request a session or send credentials", async function () {
    var host = hostWith([{ status: 202, data: { error: "approval_required" } }],
        { requestId: requestId, code: code });
    await assert.rejects(helper.credentials(host, "123456789123456789", context()));
    assert.equal(host.calls.length, 1);
});

test("revoked token is removed instead of repeatedly exposing it", async function () {
    var host = hostWith([{ status: 401, data: { error: "unauthorized" } }], { token: token });
    await assert.rejects(helper.credentials(host, "123456789123456789", context()));
    assert.equal(JSON.parse(host.files.get(helper.FILE)).token, undefined);
});

test("expired pairing starts a fresh user-approved exchange", async function () {
    var host = hostWith([
        { status: 410, data: { error: "pairing_expired" } },
        { status: 202, data: { requestId: "c".repeat(64), code: "111111" } }
    ], { requestId: requestId, code: code });
    await assert.rejects(helper.credentials(host, "123456789123456789", context()));
    assert.equal(JSON.parse(host.files.get(helper.FILE)).code, "111111");
});

test("helper offline errors never expose raw network diagnostics", async function () {
    var host = hostWith([{ error: true }], { token: token });
    await assert.rejects(helper.credentials(host, "123456789123456789", context()), function (error) {
        assert.equal(core.toBobError(error).message.includes("DO_NOT_LOG_PRIVATE"), false);
        return true;
    });
});

test("missing login produces the fixed local app link, not an untrusted response URL", async function () {
    var host = hostWith([{ status: 409, data: {
        error: "login_required", loginURL: "https://evil.example"
    } }], { token: token });
    await assert.rejects(helper.credentials(host, "123456789123456789", context()), function (error) {
        assert.equal(core.toBobError(error).troubleshootingLink, "doubaobob://login");
        return true;
    });
});

test("cancelled login resolution performs no network requests", async function () {
    var host = hostWith([]);
    var state = context();
    state.cancelled = true;
    await assert.rejects(helper.credentials(host, "123456789123456789", state));
    assert.equal(host.calls.length, 0);
});

test("invalid tokens and cookie injection are rejected", async function () {
    var host = hostWith([{ status: 200, data: { cookie: "sessionid=a\r\nX-Test: secret" } }], { token: token });
    await assert.rejects(helper.credentials(host, "123456789123456789", context()));
    var bad = hostWith([{ status: 200, data: { token: "not-a-token" } }],
        { requestId: requestId, code: code });
    await assert.rejects(helper.credentials(bad, "123456789123456789", context()));
});

test("helper credentials drive the existing direct-to-Doubao translation flow", async function () {
    var host = hostWith([{ status: 200, data: {
        cookie: "sessionid=FAKE_HELPER_SESSION", userAgent: "WebKit Fixture"
    } }], { token: token });
    var replies = [];
    await runner.translate(host, {
        loginMode: "helper", cookie: "sessionid=FAKE_MANUAL_COOKIE", userAgent: "Manual Browser"
    }, {
        text: "Hello", from: "en", to: "zh-Hans", onCompletion: function (value) { replies.push(value); }
    });
    assert.ok(replies[0].result);
    var translation = host.calls.find(function (call) { return call.url.includes("/samantha/"); });
    assert.ok(translation.header.Cookie.includes("FAKE_HELPER_SESSION"));
    assert.equal(translation.header["User-Agent"], "WebKit Fixture");
    assert.equal(host.calls[0].url, helper.BASE + "/v1/session");
    assert.equal(host.calls[0].body, undefined);
    assert.equal(JSON.stringify(host.writes).includes("FAKE_HELPER_SESSION"), false);
});

test("manual and legacy auto with a Cookie do not read or contact a paired helper", async function () {
    for (var mode of ["manual", "auto"]) {
        var host = hostWith([], { token: token });
        var originalRead = host.file.read;
        host.file.read = function (path) {
            assert.notEqual(path, helper.FILE);
            return originalRead(path);
        };
        var replies = [];
        await runner.translate(host, { loginMode: mode, cookie: "sessionid=FAKE_MANUAL_COOKIE" }, {
            text: "Hello", from: "en", to: "zh-Hans", onCompletion: function (value) { replies.push(value); }
        });
        assert.ok(replies[0].result);
        assert.equal(host.calls.length, 2);
        assert.ok(host.calls.every(function (call) { return call.url.startsWith("https://www.doubao.com/"); }));
        assert.ok(host.calls[1].header.Cookie.includes("FAKE_MANUAL_COOKIE"));
    }
});

test("explicit legacy auto mode still uses the helper when Cookie is empty", async function () {
    var host = hostWith([{ status: 200, data: { cookie: "sessionid=FAKE_HELPER_SESSION" } }], { token: token });
    var results = [];
    await runner.validate(host, { loginMode: "auto", cookie: "  " }, function (value) { results.push(value); });
    assert.deepEqual(results, [{ result: true }]);
    assert.equal(host.calls[0].url, helper.BASE + "/v1/session");
    assert.ok(host.calls[2].header.Cookie.includes("FAKE_HELPER_SESSION"));
});

test("switching from helper to manual keeps pairing intact but stops using its session", async function () {
    var host = hostWith([{ status: 200, data: { cookie: "sessionid=FAKE_HELPER_SESSION" } }], { token: token });
    var results = [];
    var completion = function (value) { results.push(value); };
    await runner.validate(host, { loginMode: "helper" }, completion);
    var pairing = host.files.get(helper.FILE);
    var previousCalls = host.calls.length;
    await runner.validate(host, { loginMode: "manual", cookie: "sessionid=FAKE_MANUAL_COOKIE" }, completion);
    assert.deepEqual(results, [{ result: true }, { result: true }]);
    var manualCalls = host.calls.slice(previousCalls);
    assert.equal(manualCalls.length, 2);
    manualCalls.forEach(function (call) {
        assert.ok(call.url.startsWith("https://www.doubao.com/"));
        assert.ok(call.header.Cookie.includes("FAKE_MANUAL_COOKIE"));
        assert.equal(call.header.Cookie.includes("FAKE_HELPER_SESSION"), false);
    });
    assert.equal(host.files.get(helper.FILE), pairing);
});

test("helper mode does not silently use a manual Cookie when the helper is offline", async function () {
    var host = hostWith([{ error: true }], { token: token });
    var results = [];
    await runner.validate(host, { loginMode: "helper", cookie: "sessionid=FAKE_MANUAL_COOKIE" },
        function (value) { results.push(value); });
    assert.equal(results[0].result, false);
    assert.equal(results[0].error.message, messages.helperOffline);
    assert.equal(results[0].error.troubleshootingLink, "https://github.com/Z2U35/bob-plugin-doubao-web#login-helper");
    assert.equal(host.calls.length, 1);
    assert.equal(host.calls[0].header.Cookie, undefined);
});

test("an expired upstream helper session opens login once and preserves the auth error", async function () {
    var host = hostWith([
        { status: 200, data: { cookie: "sessionid=FAKE_EXPIRED" } },
        { status: 200, data: { opened: true } }
    ], { token: token });
    host.http.streamRequest = function (options) {
        options.streamHandler({ rawData: fake.data('{"code":710012001}') });
        options.handler({ response: { statusCode: 200, MIMEType: "application/json" } });
    };
    var replies = [];
    await runner.translate(host, { loginMode: "helper" }, {
        text: "Hello", from: "en", to: "zh-Hans", onCompletion: function (value) { replies.push(value); }
    });
    assert.equal(replies.length, 1);
    assert.equal(replies[0].error.type, "secretKey");
    assert.equal(replies[0].error.message, messages.helperLogin + " (710012001)");
    assert.equal(replies[0].error.troubleshootingLink, "doubaobob://login");
    assert.equal(host.calls.at(-1).url, helper.BASE + "/v1/login");
});
