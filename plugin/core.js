"use strict";

var BASE_URL = "https://www.doubao.com";
var TRANSLATE_PATH = "/samantha/plugin/stream_article_translate";
var LAUNCH_PATH = "/alice/user/launch";
var ORIGIN = "chrome-extension://dbjibobgilijgolhjdcbdebjhejelffo";
var MAX_TEXT = 12000;
var MAX_RESPONSE = 1024 * 1024;
var MAX_COOKIE = 32768;
var LANGUAGE_MAP = {
    "zh-Hans": "zh", "zh-Hant": "zh-Hant",
    en: "en", ja: "ja", ko: "ko", fr: "fr", de: "de", es: "es",
    pt: "pt", ru: "ru", it: "it", ar: "ar", th: "th", vi: "vi",
    id: "id", ms: "ms", tr: "tr", nl: "nl", pl: "pl"
};
var COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
var COOKIE_VALUE = /^[\x21-\x3a\x3c-\x7e]*$/;
var messages = require("./messages.js");

function fail(key, type, code) {
    var error = new Error(messages[key] || messages.invalidResponse);
    error.pluginError = true;
    error.type = type || "api";
    if (/^\d{1,12}$/.test(String(code))) error.safeCode = String(code);
    return error;
}

function remoteError(code) {
    var value = String(code);
    if (["710012000", "710012001", "710022013"].indexOf(value) >= 0) {
        return fail("login", "secretKey", value);
    }
    if (["710012007", "676010003"].indexOf(value) >= 0) {
        return fail("busy", "api", value);
    }
    if (["710022002", "710022004"].indexOf(value) >= 0) {
        return fail("rejected", "api", value);
    }
    return fail("remote", "api", value);
}

function httpError(status) {
    if (status === 401) return fail("login", "secretKey", status);
    if (status === 403) return fail("forbidden", "api", status);
    if (status === 429) return fail("busy", "api", status);
    return fail("network", "network", status);
}

function toBobError(error) {
    var safe = error && error.pluginError ? error : fail("network", "network");
    var result = { type: safe.type, message: safe.message };
    if (safe.safeCode) result.message += " (" + safe.safeCode + ")";
    if (safe.troubleshootingLink) result.troubleshootingLink = safe.troubleshootingLink;
    else if (safe.type === "secretKey") result.troubleshootingLink = BASE_URL + "/";
    return result;
}

function supportLanguages() {
    return ["auto"].concat(Object.keys(LANGUAGE_MAP));
}

function selectTarget(query) {
    var target = query.to && query.to !== "auto" ? query.to : query.detectTo;
    if (!Object.prototype.hasOwnProperty.call(LANGUAGE_MAP, target)) {
        throw fail("language", "unsupportedLanguage");
    }
    return { bob: target, remote: LANGUAGE_MAP[target] };
}

function selectService(value) {
    var service = value === undefined || value === "" ? "1" : String(value);
    if (["1", "0", "3"].indexOf(service) < 0) throw fail("service", "param");
    return service;
}

function validateText(text) {
    if (typeof text !== "string" || !text.trim()) throw fail("empty", "param");
    if (text.length > MAX_TEXT) throw fail("tooLong", "param");
    return text;
}

function parseCookie(text) {
    var cookies = Object.create(null);
    text.split(";").forEach(function (part) {
        part = part.trim();
        if (!part) return;
        var index = part.indexOf("=");
        var name = part.slice(0, index).trim();
        var value = part.slice(index + 1).trim();
        if (index <= 0 || !COOKIE_NAME.test(name) || !COOKIE_VALUE.test(value)) {
            throw fail("cookieFormat", "secretKey");
        }
        cookies[name] = value;
    });
    return cookies;
}

function serializeCookies(cookies) {
    return Object.keys(cookies).map(function (name) {
        return name + "=" + cookies[name];
    }).join("; ");
}

function normalizeCookie(value) {
    if (typeof value !== "string" || !value.trim()) throw fail("cookieMissing", "secretKey");
    var text = value.trim().replace(/^cookie\s*:\s*/i, "");
    if (text.length > MAX_COOKIE || /[\x00-\x1f\x7f]/.test(text)) {
        throw fail("cookieFormat", "secretKey");
    }
    var cookies = parseCookie(text);
    if (!Object.keys(cookies).some(function (name) { return !!cookies[name]; })) {
        throw fail("cookieFormat", "secretKey");
    }
    return serializeCookies(cookies);
}

function normalizeUserAgent(value) {
    var text = typeof value === "string" ? value.trim() : "";
    if (text.length > 1024 || /[^\x20-\x7e]/.test(text)) throw fail("userAgent", "param");
    return text;
}

function header(headers, name) {
    var key = Object.keys(headers || {}).filter(function (item) {
        return item.toLowerCase() === name.toLowerCase();
    })[0];
    return key === undefined ? undefined : headers[key];
}

function mergeResponseCookies(original, headers, now) {
    var cookies = parseCookie(original);
    var values = header(headers, "set-cookie");
    if (!values) return original;
    if (!Array.isArray(values)) values = [String(values)];
    // A combined Set-Cookie header can contain commas inside Expires dates.
    values.forEach(function (combined) {
        String(combined).split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/).forEach(function (entry) {
            var parts = entry.split(";");
            var pair;
            try { pair = parseCookie(parts.shift()); } catch (_) { return; }
            var name = Object.keys(pair)[0];
            if (!name) return;
            var attrs = Object.create(null);
            parts.forEach(function (part) {
                var at = part.indexOf("=");
                var key = (at < 0 ? part : part.slice(0, at)).trim().toLowerCase();
                attrs[key] = at < 0 ? "" : part.slice(at + 1).trim();
            });
            var domain = (attrs.domain || "www.doubao.com").replace(/^\./, "").toLowerCase();
            if (domain !== "doubao.com" && domain !== "www.doubao.com") return;
            // Cookies without Path belong to /alice/user, not the translation URL.
            var path = attrs.path || "/alice/user";
            if (TRANSLATE_PATH.indexOf(path) !== 0 ||
                (path.slice(-1) !== "/" && TRANSLATE_PATH.length > path.length &&
                 TRANSLATE_PATH.charAt(path.length) !== "/")) return;
            var hasAge = /^-?\d+$/.test(attrs["max-age"] || "");
            var expired = hasAge ? Number(attrs["max-age"]) <= 0 :
                !!attrs.expires && Date.parse(attrs.expires) <= now;
            if (expired) delete cookies[name];
            else cookies[name] = pair[name];
        });
    });
    var merged = serializeCookies(cookies);
    return merged.length <= MAX_COOKIE ? merged : original;
}

function randomDevice() {
    function nineDigits() { return String(100000000 + Math.floor(Math.random() * 900000000)); }
    // Protocol identifiers only; these are not authentication tokens.
    return nineDigits() + nineDigits();
}

function randomTab() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (char) {
        var value = Math.floor(Math.random() * 16);
        return (char === "x" ? value : (value & 3) | 8).toString(16);
    });
}

function makeURL(path, device, tab, launch) {
    if (path !== LAUNCH_PATH && path !== TRANSLATE_PATH) throw fail("endpoint", "param");
    launch = launch || {};
    var fields = [
        ["language", "zh"], ["browser_language", "zh-CN"], ["device_platform", "web"],
        ["aid", "586864"], ["real_aid", "586864"], ["pkg_type", "release_version"],
        ["device_id", launch.ttWid ? launch.webId || "0" : "0"],
        ["tea_uuid", device], ["web_id", device], ["is_new_user", "0"],
        ["region", launch.country || ""], ["sys_region", launch.country || ""],
        ["use-olympus-account", 1], ["samantha_web", "1"], ["version", "1.38.0"],
        ["version_code", 20800], ["pc_version", "1.38.0"], ["web_tab_id", tab]
    ];
    return BASE_URL + path + "?" + fields.map(function (pair) {
        return encodeURIComponent(pair[0]) + "=" + encodeURIComponent(String(pair[1]));
    }).join("&");
}

function makeBody(text, target, service) {
    return { raw_text: [text], target_lang: target, translate_service: service };
}

function makeHeaders(cookie, streaming, userAgent) {
    var headers = { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie };
    if (userAgent) headers["User-Agent"] = userAgent;
    if (streaming) headers.Accept = "text/event-stream";
    else headers["Agw-Js-Conv"] = "str";
    return headers;
}

function parseJSON(text) {
    try { return JSON.parse(text); } catch (_) { throw fail("invalidResponse"); }
}

function responseCode(data) {
    if (!data || typeof data !== "object") return undefined;
    return data.code !== undefined ? data.code : data.error && data.error.code;
}

function resultFor(query, target, text) {
    var source = query.from && query.from !== "auto" ? query.from : query.detectFrom;
    return { from: source || "auto", to: target, content: { format: "plain", text: text } };
}

function UTF8Decoder() {
    this.pending = 0;
    this.codepoint = 0;
    this.minimum = 0;
    this.bytes = 0;
}

UTF8Decoder.prototype.push = function (bytes) {
    this.bytes += bytes.length;
    if (this.bytes > MAX_RESPONSE) throw fail("responseTooLarge");
    var output = [];
    for (var i = 0; i < bytes.length; i++) {
        var byte = bytes[i];
        if (this.pending) {
            if ((byte & 0xc0) !== 0x80) throw fail("invalidUTF8");
            this.codepoint = (this.codepoint << 6) | (byte & 0x3f);
            this.pending--;
            if (!this.pending) {
                var value = this.codepoint;
                if (value < this.minimum || value > 0x10ffff ||
                    (value >= 0xd800 && value <= 0xdfff)) throw fail("invalidUTF8");
                if (value < 0x10000) output.push(String.fromCharCode(value));
                else {
                    value -= 0x10000;
                    output.push(String.fromCharCode(0xd800 + (value >> 10), 0xdc00 + (value & 0x3ff)));
                }
            }
        } else if (byte < 0x80) {
            output.push(String.fromCharCode(byte));
        } else if (byte >= 0xc2 && byte <= 0xdf) {
            this.pending = 1; this.codepoint = byte & 0x1f; this.minimum = 0x80;
        } else if (byte >= 0xe0 && byte <= 0xef) {
            this.pending = 2; this.codepoint = byte & 0x0f; this.minimum = 0x800;
        } else if (byte >= 0xf0 && byte <= 0xf4) {
            this.pending = 3; this.codepoint = byte & 0x07; this.minimum = 0x10000;
        } else throw fail("invalidUTF8");
    }
    return output.join("");
};

UTF8Decoder.prototype.finish = function () {
    if (this.pending) throw fail("invalidUTF8");
};

function SSEParser(source, target, onItem) {
    this.source = source;
    this.target = target;
    this.onItem = onItem || function () {};
    this.buffer = "";
    this.event = "message";
    this.data = [];
    this.started = false;
    this.done = false;
    this.text = undefined;
    this.length = 0;
}

SSEParser.prototype.dispatch = function () {
    var event = this.event;
    var raw = this.data.join("\n");
    this.event = "message";
    this.data = [];
    if (event === "done") { this.done = true; return; }
    if (event !== "json" && event !== "err") return;
    var payload = parseJSON(raw);
    var code = responseCode(payload);
    if (event === "err" || (code !== 0 && code !== "0")) throw remoteError(code);
    var items = payload && payload.data && payload.data.items;
    if (!Array.isArray(items)) throw fail("invalidResponse");
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (!item || item.index !== 0 || typeof item.res !== "string") throw fail("invalidResponse");
        if (this.text !== undefined) continue;
        var translated = item.detect_lang === this.target ? this.source : item.res;
        if (!translated.trim()) throw fail("emptyResponse");
        this.text = translated;
        this.onItem(translated);
    }
};

SSEParser.prototype.line = function (line) {
    if (!line) { this.dispatch(); return; }
    if (line.charAt(0) === ":") return;
    var colon = line.indexOf(":");
    var field = colon < 0 ? line : line.slice(0, colon);
    var value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
};

SSEParser.prototype.drain = function (final) {
    while (!this.done) {
        var at = this.buffer.search(/[\r\n]/);
        if (at < 0) break;
        var cr = this.buffer.charAt(at) === "\r";
        if (cr && at === this.buffer.length - 1 && !final) break;
        var size = cr && this.buffer.charAt(at + 1) === "\n" ? 2 : 1;
        var line = this.buffer.slice(0, at);
        this.buffer = this.buffer.slice(at + size);
        this.line(line);
    }
};

SSEParser.prototype.push = function (text) {
    if (this.done) return;
    this.length += text.length;
    if (this.length > MAX_RESPONSE) throw fail("responseTooLarge");
    if (!this.started && text.length) {
        this.started = true;
        text = text.replace(/^\ufeff/, "");
    }
    this.buffer += text;
    this.drain(false);
};

SSEParser.prototype.finish = function () {
    this.drain(true);
    if (!this.done) {
        if (this.buffer) { this.line(this.buffer); this.buffer = ""; }
        if (this.data.length || this.event !== "message") this.dispatch();
    }
    if (this.text === undefined) throw fail("emptyResponse");
    return this.text;
};

module.exports = {
    BASE_URL: BASE_URL, TRANSLATE_PATH: TRANSLATE_PATH, LAUNCH_PATH: LAUNCH_PATH,
    MAX_TEXT: MAX_TEXT, MAX_RESPONSE: MAX_RESPONSE,
    fail: fail, remoteError: remoteError, httpError: httpError, toBobError: toBobError,
    supportLanguages: supportLanguages, selectTarget: selectTarget, selectService: selectService,
    validateText: validateText, normalizeCookie: normalizeCookie, normalizeUserAgent: normalizeUserAgent,
    header: header, mergeResponseCookies: mergeResponseCookies,
    randomDevice: randomDevice, randomTab: randomTab, makeURL: makeURL,
    makeBody: makeBody, makeHeaders: makeHeaders, parseJSON: parseJSON,
    responseCode: responseCode, resultFor: resultFor,
    UTF8Decoder: UTF8Decoder, SSEParser: SSEParser
};
