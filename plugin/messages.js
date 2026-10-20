"use strict";

// User-facing localization; request bodies and credentials are never interpolated.
module.exports = {
    helperOffline: "请先安装并打开「Doubao Login Helper」登录助手。完成豆包官方登录后，回到 Bob 再次验证；使用期间需保持助手运行。",
    helperPair: "首次连接：请在登录助手中核对并允许下面的配对码，然后回 Bob 再次点击验证。配对码：",
    helperPairBusy: "登录助手正等待另一次配对确认，请先处理助手中的提示后重试。",
    helperRevoked: "与登录助手的配对已失效。请再次验证，并在助手中确认新的配对请求。",
    helperLogin: "请在登录助手打开的豆包官方网页中完成扫码或验证码登录，再回 Bob 验证。",
    helperStorage: "无法保存本机配对信息。请检查 Bob 插件沙盒是否可写；也可以切换为手动 Cookie 模式。",
    helperResponse: "登录助手返回的数据不符合预期。请确认安装了与插件配套的助手，并检查本机 17643 端口是否被占用。",
    cookieMissing: "请先在插件设置中填写豆包登录 Cookie；这里不是 API Key。",
    cookieFormat: "Cookie 格式不正确。请复制豆包请求头中 Cookie 的完整值，不要粘贴 cURL、JSON 或多行请求头。",
    userAgent: "User-Agent 格式不正确。请只填写浏览器请求头的值，不要包含换行。",
    login: "豆包登录状态无效或已过期。请在浏览器重新登录豆包，再更新插件中的 Cookie。",
    busy: "豆包服务繁忙或请求过于频繁。请稍后重试；插件不会自动反复请求。",
    rejected: "豆包拒绝了这次翻译。请检查文本内容，或稍后重试。",
    forbidden: "豆包拒绝访问（可能需要网页端验证）。请先在浏览器确认豆包可用，再更新 Cookie。",
    remote: "豆包返回服务错误。请稍后重试；若持续出现，接口可能已变更。",
    invalidResponse: "豆包返回了无法识别的数据，接口格式可能已变更。",
    emptyResponse: "豆包没有返回完整译文，请稍后重试或缩短文本。",
    network: "请求失败或超时。请检查网络，并确认浏览器能正常访问豆包。",
    cancelled: "翻译已取消。",
    language: "暂不支持该目标语言，请在 Bob 中选择插件支持的语言。",
    service: "翻译服务选项无效，请在插件设置中重新选择。",
    empty: "没有可翻译的文本。",
    tooLong: "文本超过本插件的 12000 字符安全上限，请分段翻译（部分 emoji 占两个字符）。",
    responseTooLarge: "豆包返回数据过大，请缩短文本后重试。",
    invalidUTF8: "豆包返回的文本编码不完整或无效，请重试。",
    endpoint: "接口地址无效。本插件只允许调用固定的豆包接口。",
    redirect: "请求被重定向到了非豆包地址，已停止处理响应。"
};
