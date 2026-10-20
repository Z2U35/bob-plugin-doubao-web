"use strict";

var core = require("./core.js");
var runner = require("./runner.js");

function host() {
    return { http: $http, file: $file, data: $data, signal: $signal };
}

function supportLanguages() {
    return core.supportLanguages();
}

function translate(query, completion) {
    return runner.translate(host(), {
        cookie: $option.cookie, service: $option.service, userAgent: $option.userAgent, loginMode: $option.loginMode
    }, query, completion);
}

function pluginValidate(completion) {
    return runner.validate(host(), {
        cookie: $option.cookie, service: $option.service, userAgent: $option.userAgent, loginMode: $option.loginMode
    }, completion);
}

function pluginTimeoutInterval() {
    return 120;
}

if (typeof module !== "undefined") {
    module.exports = {
        supportLanguages: supportLanguages,
        translate: translate,
        pluginValidate: pluginValidate,
        pluginTimeoutInterval: pluginTimeoutInterval
    };
}
