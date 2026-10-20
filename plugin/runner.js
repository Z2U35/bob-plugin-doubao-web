"use strict";

var core = require("./core.js");
var helper = require("./helper.js");
var DEVICE_FILE = "$sandbox/doubao-web-device.json";

function loadDevice(host) {
    try {
        if (host.file.exists(DEVICE_FILE)) {
            var saved = JSON.parse(host.file.read(DEVICE_FILE).toUTF8());
            if (saved.schemaVersion === 1 && /^\d{18}$/.test(saved.teaUuid)) return saved.teaUuid;
        }
    } catch (_) {}
    var device = core.randomDevice();
    try {
        host.file.write({
            path: DEVICE_FILE,
            data: host.data.fromUTF8(JSON.stringify({ schemaVersion: 1, teaUuid: device }))
        });
    } catch (_) {}
    return device;
}

function checkCancelled(context) {
    if (context.cancelled) throw core.fail("cancelled", "unknown");
}

function checkResponseOrigin(response) {
    if (response && response.url && !/^https:\/\/www\.doubao\.com(?:\/|$)/i.test(response.url)) {
        throw core.fail("redirect", "network");
    }
}

function request(host, options) {
    return new Promise(function (resolve, reject) {
        options.handler = resolve;
        try { host.http.request(options); } catch (_) { reject(core.fail("network", "network")); }
    });
}

async function initialize(host, context) {
    var reply;
    try {
        reply = await request(host, {
            method: "POST",
            url: core.makeURL(core.LAUNCH_PATH, context.device, context.tab),
            header: core.makeHeaders(context.cookie, false, context.userAgent),
            timeout: 12,
            cancelSignal: context.signal
        });
    } catch (_) {
        checkCancelled(context);
        return;
    }
    checkCancelled(context);
    var response = reply && reply.response;
    checkResponseOrigin(response);
    if (!reply || reply.error || !response || response.statusCode < 200 || response.statusCode >= 300) return;
    context.cookie = core.mergeResponseCookies(context.cookie, response.headers, Date.now());
    var payload = reply.data;
    if (typeof payload === "string") {
        try { payload = JSON.parse(payload); } catch (_) { return; }
    }
    if (!payload || (payload.code !== 0 && payload.code !== "0") || !payload.data) return;
    var config = payload.data.config || {};
    function limited(value) {
        return typeof value === "string" || typeof value === "number" ? String(value).slice(0, 64) : "";
    }
    context.launch = {
        ttWid: !!config.ttwid, webId: limited(config.web_id), country: limited(payload.data.country)
    };
}

function streamTranslation(host, context, text, target, service, onItem) {
    return new Promise(function (resolve, reject) {
        var settled = false;
        var decoder = new core.UTF8Decoder();
        var parser = new core.SSEParser(text, target, onItem);
        var raw = "";
        var parseError;
        var stoppedOnDone = false;
        var completedText;

        function settle(error, value) {
            if (settled) return;
            settled = true;
            if (error) reject(error);
            else resolve(value);
        }

        function stop() {
            try { context.signal.send(); } catch (_) {}
        }

        var options = {
            method: "POST",
            url: core.makeURL(core.TRANSLATE_PATH, context.device, context.tab, context.launch),
            header: core.makeHeaders(context.cookie, true, context.userAgent),
            body: core.makeBody(text, target, service),
            timeout: 65,
            cancelSignal: context.signal,
            streamHandler: function (stream) {
                if (settled || parseError || stoppedOnDone || context.cancelled) return;
                try {
                    // stream.text may be empty when a UTF-8 character straddles chunks.
                    if (decoder.bytes + stream.rawData.length > core.MAX_RESPONSE) {
                        throw core.fail("responseTooLarge");
                    }
                    var chunk = decoder.push(stream.rawData.toByteArray());
                    raw += chunk;
                    parser.push(chunk);
                    if (parser.done) {
                        decoder.finish();
                        completedText = parser.finish();
                        stoppedOnDone = true;
                        stop();
                    }
                } catch (error) {
                    parseError = error && error.pluginError ? error : core.fail("invalidResponse");
                    stop();
                }
            },
            handler: function (reply) {
                if (settled) return;
                try {
                    checkCancelled(context);
                    var response = reply && reply.response;
                    checkResponseOrigin(response);
                    var status = response && response.statusCode;
                    if (status && (status < 200 || status >= 300)) throw core.httpError(status);
                    if (parseError) throw parseError;
                    if (stoppedOnDone) {
                        // Bob reports a cancellation error when we close a completed SSE stream.
                        settle(null, completedText);
                        return;
                    }
                    if (!reply || reply.error) throw core.fail("network", "network");
                    decoder.finish();
                    var mime = String(core.header(response && response.headers, "content-type") ||
                        (response && response.MIMEType) || "");
                    if ((mime && !/^text\/event-stream(?:\s*;|$)/i.test(mime)) || /^\s*\{/.test(raw)) {
                        var code = core.responseCode(core.parseJSON(raw));
                        if (code !== undefined && code !== 0 && code !== "0") throw core.remoteError(code);
                        throw core.fail("invalidResponse");
                    }
                    settle(null, parser.finish());
                } catch (error) {
                    settle(error);
                }
            }
        };
        try {
            checkCancelled(context);
            host.http.streamRequest(options);
        } catch (error) {
            settle(error && error.pluginError ? error : core.fail("network", "network"));
        }
    });
}

async function perform(host, options, query, onItem) {
    var text = core.validateText(query.text);
    var target = core.selectTarget(query);
    var service = core.selectService(options.service);
    var context = {
        cookie: "",
        userAgent: "",
        device: loadDevice(host),
        tab: core.randomTab(),
        signal: host.signal.new(),
        cancelled: false,
        launch: {}
    };
    var subscription;
    if (query.cancelSignal && typeof query.cancelSignal.subscribe === "function") {
        subscription = query.cancelSignal.subscribe(function () {
            context.cancelled = true;
            context.signal.send();
        });
    }
    try {
        var mode = options.loginMode || "auto";
        if (["auto", "helper", "manual"].indexOf(mode) < 0) throw core.fail("service", "param");
        var manual = mode === "manual" || (mode === "auto" && !!String(options.cookie || "").trim());
        if (manual) {
            context.cookie = core.normalizeCookie(options.cookie);
            context.userAgent = core.normalizeUserAgent(options.userAgent);
        } else {
            var session = await helper.credentials(host, context.device, context);
            context.cookie = session.cookie;
            context.userAgent = session.userAgent;
            context.helperToken = session.helperToken;
        }
        await initialize(host, context);
        checkCancelled(context);
        var translated = await streamTranslation(host, context, text, target.remote, service, function (value) {
            if (!context.cancelled && onItem) onItem(core.resultFor(query, target.bob, value));
        });
        checkCancelled(context);
        return core.resultFor(query, target.bob, translated);
    } catch (error) {
        if (context.helperToken && error && error.type === "secretKey" && !context.cancelled) {
            await helper.showLogin(host, context.helperToken, context.signal);
        }
        throw error;
    } finally {
        if (subscription) subscription.dispose();
        context.cookie = "";
        context.helperToken = "";
    }
}

function translate(host, options, query, fallbackCompletion) {
    var completion = typeof query.onCompletion === "function" ? query.onCompletion : fallbackCompletion;
    var finished = false;
    function finish(value) {
        if (finished) return;
        finished = true;
        if (typeof completion === "function") completion(value);
    }
    return perform(host, options, query, function (result) {
        if (typeof query.onStream === "function") query.onStream(result);
    }).then(function (result) {
        finish({ result: result });
    }, function (error) {
        finish({ error: core.toBobError(error) });
    });
}

function validate(host, options, completion) {
    var query = { text: "Hello, world!", from: "en", to: "zh-Hans" };
    return perform(host, options, query).then(function () {
        completion({ result: true });
    }, function (error) {
        completion({ result: false, error: core.toBobError(error) });
    });
}

module.exports = { translate: translate, validate: validate, loadDevice: loadDevice };
