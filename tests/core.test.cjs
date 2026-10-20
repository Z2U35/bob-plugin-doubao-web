"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var core = require("../plugin/core.js");
var fake = require("./fake-bob.cjs");

test("language mapping uses Bob codes and a concrete automatic target", function () {
    assert.deepEqual(core.selectTarget({ to: "zh-Hans" }), { bob: "zh-Hans", remote: "zh" });
    assert.deepEqual(core.selectTarget({ to: "auto", detectTo: "zh-Hant" }), { bob: "zh-Hant", remote: "zh-Hant" });
    assert.equal(core.selectTarget({ to: "en", detectTo: "zh-Hans" }).remote, "en");
    assert.equal(core.supportLanguages().length, 20);
    assert.throws(function () { core.selectTarget({ to: "yue" }); }, { type: "unsupportedLanguage" });
    assert.throws(function () { core.selectTarget({ to: "__proto__" }); });
    assert.throws(function () { core.selectTarget({ to: "auto", detectTo: "auto" }); });
});

test("all three service values, including zero, are preserved", function () {
    ["1", "0", "3"].forEach(function (value) { assert.equal(core.selectService(value), value); });
    assert.equal(core.selectService(undefined), "1");
    assert.throws(function () { core.selectService("2"); }, { type: "param" });
});

test("text validation preserves formatting and enforces a local bound", function () {
    assert.equal(core.validateText("  one\n\n two  "), "  one\n\n two  ");
    assert.throws(function () { core.validateText(" \n "); }, { type: "param" });
    assert.throws(function () { core.validateText(null); }, { type: "param" });
    assert.equal(core.validateText("a".repeat(core.MAX_TEXT)).length, core.MAX_TEXT);
    assert.throws(function () { core.validateText("a".repeat(core.MAX_TEXT + 1)); });
});

test("Cookie normalization accepts a header prefix and preserves encoded values", function () {
    assert.equal(core.normalizeCookie(" Cookie: sessionid=fake; token=a=b%3D; "), "sessionid=fake; token=a=b%3D");
});

test("Cookie parser rejects header injection, JSON and command-line snippets", function () {
    ["", "   ", "Bearer fake", '{"sessionid":"fake"}', "curl https://example.com",
        "sessionid=x\r\nAuthorization: y", "sessionid=a\nb", "sessionid=\u0000",
        "sessionid=" + "a".repeat(32768)].forEach(function (value) {
        assert.throws(function () { core.normalizeCookie(value); }, { type: "secretKey" });
    });
});

test("Cookie names cannot poison object prototypes", function () {
    assert.equal(core.normalizeCookie("__proto__=fake; constructor=fake"), "__proto__=fake; constructor=fake");
    assert.equal({}.fake, undefined);
});

test("response cookies handle Expires commas and match domain/path", function () {
    var result = core.mergeResponseCookies("sessionid=old; ttwid=old", {
        "SET-cookie": "ttwid=new; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/; Domain=.doubao.com, " +
            "sessionid=renewed; Path=/samantha; Domain=www.doubao.com"
    }, Date.UTC(2026, 9, 20));
    assert.equal(result, "sessionid=renewed; ttwid=new");
});

test("response cookies reject unrelated hosts and nonmatching default paths", function () {
    var result = core.mergeResponseCookies("sessionid=original", {
        "Set-Cookie": [
            "sessionid=evil; Domain=evil.example; Path=/",
            "sessionid=wrongpath; Path=/alice",
            "sessionid=nopath",
            "sessionid=partial; Path=/samanth",
            "bad-cookie",
            "sessionid=accepted; Path=/samantha/plugin/"
        ]
    }, Date.now());
    assert.equal(result, "sessionid=accepted");
});

test("expired cookies are removed and Max-Age takes precedence", function () {
    var result = core.mergeResponseCookies("a=1; b=2; c=3", {
        "Set-Cookie": [
            "a=gone; Path=/; Max-Age=0",
            "b=gone; Path=/; Expires=Wed, 21 Oct 2015 07:28:00 GMT",
            "c=keep; Path=/; Max-Age=10; Expires=Wed, 21 Oct 2015 07:28:00 GMT"
        ]
    }, Date.now());
    assert.equal(result, "c=keep");
});

test("oversized response cookies do not expand the credential header", function () {
    var result = core.mergeResponseCookies("sessionid=fake", {
        "Set-Cookie": "ttwid=" + "x".repeat(32768) + "; Path=/"
    }, Date.now());
    assert.equal(result, "sessionid=fake");
});

test("optional User-Agent is bounded and cannot inject headers", function () {
    assert.equal(core.normalizeUserAgent(" Mozilla/5.0 "), "Mozilla/5.0");
    assert.equal(core.normalizeUserAgent(undefined), "");
    assert.throws(function () { core.normalizeUserAgent("Mozilla/5.0\nCookie: fake"); });
    assert.throws(function () { core.normalizeUserAgent("x".repeat(1025)); });
});

test("URLs reproduce the observed protocol and never put credentials in the URL", function () {
    var url = new URL(core.makeURL(core.TRANSLATE_PATH, "123456789123456789", "tab", {
        ttWid: true, webId: "12345", country: "CN"
    }));
    assert.equal(url.origin, "https://www.doubao.com");
    assert.equal(url.pathname, "/samantha/plugin/stream_article_translate");
    assert.deepEqual(Array.from(url.searchParams.keys()), [
        "language", "browser_language", "device_platform", "aid", "real_aid", "pkg_type",
        "device_id", "tea_uuid", "web_id", "is_new_user", "region", "sys_region",
        "use-olympus-account", "samantha_web", "version", "version_code", "pc_version", "web_tab_id"
    ]);
    assert.equal(url.searchParams.get("device_id"), "12345");
    assert.equal(url.searchParams.get("aid"), "586864");
    assert.equal(url.searchParams.get("version"), "1.38.0");
    assert.equal(url.searchParams.get("version_code"), "20800");
    assert.throws(function () { core.makeURL("https://evil.example", "id", "tab"); });
});

test("identifiers have the same shapes as the extension", function () {
    assert.match(core.randomDevice(), /^[1-9]\d{8}[1-9]\d{8}$/);
    assert.match(core.randomTab(), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});

test("translation payload is a translation API, not a chat prompt", function () {
    assert.deepEqual(core.makeBody("Hello", "zh", "0"), {
        raw_text: ["Hello"], target_lang: "zh", translate_service: "0"
    });
    var headers = core.makeHeaders("sessionid=fake", true, "Fixture/1.0");
    assert.equal(headers.Accept, "text/event-stream");
    assert.equal(headers["User-Agent"], "Fixture/1.0");
    assert.equal(headers.Origin, "chrome-extension://dbjibobgilijgolhjdcbdebjhejelffo");
    assert.equal(headers.Authorization, undefined);
});

test("UTF-8 decoder preserves Chinese and emoji across every byte boundary", function () {
    var source = "Hello \u4f60\u597d \ud83c\udf0d \ud83d\ude80 \u00e9";
    var bytes = Buffer.from(source);
    for (var split = 0; split <= bytes.length; split++) {
        var decoder = new core.UTF8Decoder();
        assert.equal(decoder.push(bytes.subarray(0, split)) + decoder.push(bytes.subarray(split)), source);
        decoder.finish();
    }
});

test("UTF-8 decoder rejects overlong, surrogate and out-of-range encodings", function () {
    [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80],
        [0xe0, 0x80, 0x80], [0xe4, 0x41], [0xff]].forEach(function (bytes) {
        assert.throws(function () { new core.UTF8Decoder().push(bytes); });
    });
});

test("UTF-8 decoder rejects incomplete terminal characters and oversized streams", function () {
    var decoder = new core.UTF8Decoder();
    decoder.push([0xe4, 0xbd]);
    assert.throws(function () { decoder.finish(); });
    assert.throws(function () { new core.UTF8Decoder().push(Buffer.alloc(core.MAX_RESPONSE + 1)); });
});

test("SSE parser tolerates every character boundary and CRLF splitting", function () {
    var input = fake.event("\u4f60\u597d\ud83c\udf0d").replace(/\n/g, "\r\n");
    for (var split = 0; split <= input.length; split++) {
        var parser = new core.SSEParser("Hello", "zh");
        parser.push(input.slice(0, split));
        parser.push(input.slice(split));
        assert.equal(parser.finish(), "\u4f60\u597d\ud83c\udf0d");
        assert.equal(parser.done, true);
    }
});

test("SSE parser supports BOM, comments, multiline data, and bare CR", function () {
    var parser = new core.SSEParser("Hello", "zh");
    parser.push("\ufeff: heartbeat\revent: json\rdata: {\"code\":0,\r");
    parser.push("data: \"data\":{\"items\":[{\"index\":0,\"res\":\"OK\"}]}}\r\revent: done\r\r");
    assert.equal(parser.finish(), "OK");
});

test("SSE parser preserves whitespace and ignores duplicate item indices", function () {
    var values = [];
    var parser = new core.SSEParser("Hello", "zh", function (value) { values.push(value); });
    var first = fake.event("  A\n\nB  ").split("event: done")[0];
    parser.push(first + fake.event("duplicate"));
    assert.equal(parser.finish(), "  A\n\nB  ");
    assert.deepEqual(values, ["  A\n\nB  "]);
});

test("matching detected language returns the unmodified source", function () {
    var parser = new core.SSEParser(" original ", "en");
    parser.push(fake.event("do not use", { detect_lang: "en" }));
    assert.equal(parser.finish(), " original ");
});

test("Simplified to Traditional is not incorrectly short-circuited", function () {
    var parser = new core.SSEParser("\u6c49\u5b57", "zh-Hant");
    parser.push(fake.event("\u6f22\u5b57", { detect_lang: "zh" }));
    assert.equal(parser.finish(), "\u6f22\u5b57");
});

test("SSE parser accepts a complete final record without a done marker or final newline", function () {
    var parser = new core.SSEParser("Hello", "zh");
    parser.push(fake.event("OK").split("\n\nevent: done")[0]);
    assert.equal(parser.finish(), "OK");
});

test("SSE protocol errors map authentication, rate limits, and rejection codes", function () {
    ["710012001", "710012007", "710022004"].forEach(function (code) {
        var parser = new core.SSEParser("Hello", "zh");
        assert.throws(function () {
            parser.push("event: err\ndata: " + JSON.stringify({ code: code }) + "\n\n");
        }, { safeCode: code });
    });
});

test("SSE parser rejects incomplete or malformed translations", function () {
    [
        "event: done\n\n",
        "event: json\ndata: invalid\n\n",
        "event: json\ndata: {\"code\":0,\"data\":{}}\n\n",
        fake.event("", { detect_lang: "en" }),
        fake.event("bad", { index: 1 }),
        fake.event("bad", { index: "0" })
    ].forEach(function (input) {
        assert.throws(function () {
            var parser = new core.SSEParser("Hello", "zh");
            parser.push(input);
            parser.finish();
        });
    });
});

test("SSE parser bounds buffered lines", function () {
    assert.throws(function () {
        new core.SSEParser("Hello", "zh").push("x".repeat(core.MAX_RESPONSE + 1));
    });
});

test("Bob errors never expose arbitrary upstream text or nonnumeric codes", function () {
    var error = core.toBobError(new Error("sessionid=VERY_PRIVATE"));
    assert.equal(JSON.stringify(error).includes("VERY_PRIVATE"), false);
    var remote = core.toBobError(core.remoteError("PRIVATE_COOKIE"));
    assert.equal(JSON.stringify(remote).includes("PRIVATE_COOKIE"), false);
    assert.equal(core.toBobError(core.remoteError(710012001)).type, "secretKey");
    assert.equal(core.toBobError(core.httpError(429)).type, "api");
});
