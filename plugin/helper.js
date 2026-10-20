"use strict";

var core = require("./core.js");
var BASE = "http://127.0.0.1:17643";
var FILE = "$sandbox/doubao-helper-pairing.json";
var GUIDE = "https://github.com/Z2U35/bob-plugin-doubao-web#安装";

function error(key, code) {
    var value = core.fail(key, "secretKey");
    if (code && /^\d{6}$/.test(code)) value.message += " " + code;
    value.troubleshootingLink = key === "helperLogin" ? "doubaobob://login" : GUIDE;
    return value;
}

function read(host) {
    try {
        var saved = JSON.parse(host.file.read(FILE).toUTF8());
        if (saved.version === 1) return saved;
    } catch (_) {}
    return {};
}

function write(host, value) {
    try {
        var ok = host.file.write({
            path: FILE, data: host.data.fromUTF8(JSON.stringify(Object.assign({ version: 1 }, value)))
        });
        if (ok === false) throw new Error("write");
    } catch (_) { throw error("helperStorage"); }
}

function call(host, path, body, token, signal) {
    return new Promise(function (resolve, reject) {
        var headers = { "Content-Type": "application/json", "X-Doubao-Bob-Client": "bob-plugin-v1" };
        if (token) headers.Authorization = "Bearer " + token;
        var options = {
            method: body === undefined ? "GET" : "POST",
            url: BASE + path, header: headers, timeout: 4, cancelSignal: signal,
            handler: function (reply) {
                if (!reply || reply.error || !reply.response) return reject(error("helperOffline"));
                if (reply.response.url && reply.response.url !== options.url) return reject(error("helperResponse"));
                var data = reply.data;
                try { if (typeof data === "string") data = JSON.parse(data); } catch (_) {}
                if (!data || typeof data !== "object") return reject(error("helperResponse"));
                resolve({ status: reply.response.statusCode, data: data });
            }
        };
        if (body !== undefined) options.body = body;
        try { host.http.request(options); } catch (_) { reject(error("helperOffline")); }
    });
}

async function credentials(host, clientId, context) {
    function cancelled() {
        if (context.cancelled) throw core.fail("cancelled", "unknown");
    }
    cancelled();
    var saved = read(host);
    var token = /^[a-f0-9]{64}$/.test(saved.token || "") ? saved.token : "";
    if (!token && /^[a-f0-9]{64}$/.test(saved.requestId || "")) {
        var claim = await call(host, "/v1/pair/claim", { requestId: saved.requestId }, "", context.signal);
        cancelled();
        if (claim.status === 202) throw error("helperPair", saved.code);
        if (claim.status === 200 && /^[a-f0-9]{64}$/.test(claim.data.token || "")) {
            token = claim.data.token;
            write(host, { token: token });
        } else if (claim.status === 410 || claim.status === 403) {
            write(host, {});
            saved = {};
        } else throw error("helperResponse");
    }
    if (!token) {
        var pair = await call(host, "/v1/pair/start", { clientId: clientId }, "", context.signal);
        cancelled();
        if (pair.status === 429) throw error("helperPairBusy");
        if (pair.status !== 202 || !/^[a-f0-9]{64}$/.test(pair.data.requestId || "") ||
            !/^\d{6}$/.test(pair.data.code || "")) throw error("helperResponse");
        write(host, { requestId: pair.data.requestId, code: pair.data.code });
        throw error("helperPair", pair.data.code);
    }
    var reply = await call(host, "/v1/session", undefined, token, context.signal);
    cancelled();
    if (reply.status === 401) {
        write(host, {});
        throw error("helperRevoked");
    }
    if (reply.status === 409 && reply.data.error === "login_required") throw error("helperLogin");
    if (reply.status !== 200 || typeof reply.data.cookie !== "string") throw error("helperResponse");
    return {
        cookie: core.normalizeCookie(reply.data.cookie),
        userAgent: core.normalizeUserAgent(reply.data.userAgent),
        helperToken: token
    };
}

async function showLogin(host, token, signal) {
    if (!token) return;
    try { await call(host, "/v1/login", {}, token, signal); } catch (_) {}
}

module.exports = { credentials: credentials, showLogin: showLogin, BASE: BASE, FILE: FILE };
