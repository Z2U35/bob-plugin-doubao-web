"use strict";

function signal() {
    var subscribers = new Set();
    return {
        send: function (value) { Array.from(subscribers).forEach(function (fn) { fn(value); }); },
        subscribe: function (fn) {
            subscribers.add(fn);
            return { dispose: function () { subscribers.delete(fn); } };
        },
        size: function () { return subscribers.size; }
    };
}

function data(value) {
    var buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return {
        length: buffer.length,
        toUTF8: function () { return buffer.toString("utf8"); },
        toByteArray: function () { return Array.from(buffer); }
    };
}

function event(text, extra) {
    return "event: json\ndata: " + JSON.stringify({
        code: 0,
        data: { items: [Object.assign({ index: 0, res: text, detect_lang: "en" }, extra)] }
    }) + "\n\nevent: done\ndata: {}\n\n";
}

function createHost(settings) {
    settings = settings || {};
    var files = settings.files || new Map();
    var calls = [];
    var writes = [];
    var host = {
        signal: { new: signal },
        data: { fromUTF8: data },
        file: {
            exists: function (path) { return files.has(path); },
            read: function (path) { return data(files.get(path)); },
            write: function (object) {
                writes.push({ path: object.path, text: object.data.toUTF8() });
                files.set(object.path, object.data.toUTF8());
                return true;
            }
        },
        calls: calls, writes: writes, files: files
    };
    host.http = {
        request: function (options) {
            calls.push(options);
            if (settings.request) return settings.request(options);
            options.handler({
                data: { code: 0, data: { config: { ttwid: "fixture", web_id: "1234567" }, country: "CN" } },
                response: {
                    statusCode: 200,
                    url: options.url,
                    headers: { "Set-Cookie": "ttwid=fixture; Path=/; Domain=.doubao.com" }
                }
            });
        },
        streamRequest: function (options) {
            calls.push(options);
            if (settings.stream) return settings.stream(options);
            var response = {
                statusCode: settings.status || 200,
                url: settings.responseURL || options.url,
                headers: { "Content-Type": settings.mime || "text/event-stream; charset=utf-8" }
            };
            var finished = false;
            var disposable = options.cancelSignal.subscribe(function () {
                if (finished) return;
                finished = true;
                disposable.dispose();
                options.handler({
                    response: settings.noResponseOnCancel ? undefined : response,
                    error: { message: "Request cancelled (fixture)" }
                });
            });
            var bytes = Buffer.from(settings.body === undefined ? event("Translated text") : settings.body);
            var size = settings.chunkSize || 7;
            for (var i = 0; i < bytes.length && !finished; i += size) {
                var chunk = bytes.subarray(i, i + size);
                options.streamHandler({ rawData: data(chunk), text: "" });
                if (settings.afterChunk) settings.afterChunk(options, i);
            }
            if (!finished) {
                finished = true;
                disposable.dispose();
                options.handler({ response: response, error: settings.error });
            }
        }
    };
    return host;
}

module.exports = { signal: signal, data: data, event: event, createHost: createHost };
