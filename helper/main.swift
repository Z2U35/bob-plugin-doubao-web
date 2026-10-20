import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKHTTPCookieStoreObserver, WKNavigationDelegate, WKUIDelegate {
    private let keychain = PrivateKeychain()
    private let server = LoopbackServer()
    private let pairing = PairingState()
    private var bridgeToken = ""
    private var cookies: [HTTPCookie] = []
    private var userAgent = ""
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusLabel: NSTextField!
    private var addressLabel: NSTextField!
    private var statusItem: NSStatusItem!
    private var snapshotWork: DispatchWorkItem?
    private var cookieEpoch = 0
    private var clearing = false
    private var presentedPair = ""
    private var bridgeReady = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        makeMenu()
        makeWindow()
        do {
            if let data = try keychain.read("bridge-token"), let text = String(data: data, encoding: .utf8),
               text.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil {
                bridgeToken = text
            }
        } catch { status("无法读取钥匙串中的配对信息，请重新配对。") }
        server.handle = { [weak self] request, reply in self?.route(request, reply: reply) }
        server.stateChanged = { [weak self] ready in
            guard let self else { return }
            self.bridgeReady = ready
            if !ready {
                self.status("无法监听 127.0.0.1:17643。请检查是否重复启动了助手，或端口已被其他程序占用。")
            } else { self.updateStatus() }
        }
        do { try server.start() } catch { status("本机连接启动失败。请检查 17643 端口是否被占用。") }
        restoreSession()
        showWindow()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow(); return true
    }
    func application(_ application: NSApplication, open urls: [URL]) {
        if urls.contains(where: { $0.scheme == "doubaobob" && $0.host == "login" }) { showWindow() }
    }

    private func makeMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "豆包登录"
        let menu = NSMenu()
        let show = NSMenuItem(title: "打开登录助手", action: #selector(showAction), keyEquivalent: "")
        show.target = self
        menu.addItem(show)
        let clear = NSMenuItem(title: "清除本机登录", action: #selector(clearLogin), keyEquivalent: "")
        clear.target = self
        menu.addItem(clear)
        let revoke = NSMenuItem(title: "撤销 Bob 配对", action: #selector(revokePairing), keyEquivalent: "")
        revoke.target = self
        menu.addItem(revoke)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "退出登录助手", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
        statusItem.menu = menu
        let mainMenu = NSMenu()
        let item = NSMenuItem()
        item.submenu = menu.copy() as? NSMenu
        mainMenu.addItem(item)
        NSApp.mainMenu = mainMenu
    }

    private func makeWindow() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1000, height: 760),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "豆包登录助手 · 本机配对"
        window.minSize = NSSize(width: 720, height: 560)
        window.isReleasedWhenClosed = false
        window.center()
        let root = NSView()
        window.contentView = root
        let title = NSTextField(labelWithString: "在豆包官方网页登录，不需要复制 Cookie")
        title.font = .boldSystemFont(ofSize: 17)
        let privacy = NSTextField(wrappingLabelWithString:
            "扫码或验证码由豆包网页处理。仅保存本窗口产生的豆包登录态；不读取 Chrome / Safari 的数据。")
        statusLabel = NSTextField(wrappingLabelWithString: "正在启动本机连接…")
        statusLabel.textColor = .secondaryLabelColor
        addressLabel = NSTextField(labelWithString: "官方页面：https://www.doubao.com/chat/")
        addressLabel.isSelectable = true
        let refresh = NSButton(title: "打开 / 刷新官网", target: self, action: #selector(reloadLogin))
        let clear = NSButton(title: "清除本机登录", target: self, action: #selector(clearLogin))
        let revoke = NSButton(title: "撤销 Bob 配对", target: self, action: #selector(revokePairing))
        let buttons = NSStackView(views: [refresh, clear, revoke])
        buttons.spacing = 10
        let header = NSStackView(views: [title, privacy, statusLabel, addressLabel, buttons])
        header.orientation = .vertical
        header.alignment = .leading
        header.spacing = 8
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        let footer = NSTextField(labelWithString: "v0.2.0 · 仅监听 127.0.0.1:17643 · 关闭窗口后仍在菜单栏运行")
        footer.textColor = .secondaryLabelColor
        for view in [header, webView!, footer] {
            view.translatesAutoresizingMaskIntoConstraints = false
            root.addSubview(view)
        }
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: root.topAnchor, constant: 16),
            header.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 18),
            header.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -18),
            webView.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 12),
            webView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: footer.topAnchor, constant: -8),
            footer.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 18),
            footer.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -10)
        ])
    }

    private func status(_ text: String) { statusLabel.stringValue = text }
    private func updateStatus() {
        guard bridgeReady else { return }
        if BridgePolicy.hasSession(cookies) {
            status("已检测到豆包登录凭证。请回 Bob 点击「验证」；有效性由实际翻译请求确认。")
        } else { status("请在下方官方网页完成登录。随后回 Bob 验证，首次连接需确认一次配对码。") }
    }
    private func showWindow() {
        guard window != nil else { return }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    @objc private func showAction() { showWindow() }
    @objc private func reloadLogin() {
        showWindow()
        webView.load(URLRequest(url: URL(string: "https://www.doubao.com/chat/")!))
    }

    private func restoreSession() {
        var restored: [HTTPCookie] = []
        do {
            if let data = try keychain.read("session"), data.count <= 128 * 1024 {
                let saved = try JSONDecoder().decode(SavedSession.self, from: data)
                restored = saved.cookies.compactMap { $0.restore() }
                userAgent = saved.userAgent
            }
        } catch { status("无法恢复上次登录，请在下方官网重新登录。") }
        cookies = restored
        let group = DispatchGroup()
        let store = webView.configuration.websiteDataStore.httpCookieStore
        for cookie in restored {
            group.enter()
            store.setCookie(cookie) { group.leave() }
        }
        group.notify(queue: .main) {
            store.add(self)
            self.reloadLogin()
        }
    }

    func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
        snapshotWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.snapshotCookies() }
        snapshotWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
    }

    private func snapshotCookies() {
        guard !clearing else { return }
        let epoch = cookieEpoch
        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] all in
            DispatchQueue.main.async {
                guard let self, !self.clearing, epoch == self.cookieEpoch else { return }
                self.cookies = all.filter { BridgePolicy.isDoubaoDomain($0.domain) }
                do {
                    if BridgePolicy.hasSession(self.cookies) {
                        let saved = SavedSession(cookies: self.cookies.map(SavedCookie.init), userAgent: self.userAgent)
                        let data = try JSONEncoder().encode(saved)
                        guard data.count <= 128 * 1024 else { throw BridgeFailure.oversized }
                        try self.keychain.write("session", data: data)
                    } else { try self.keychain.delete("session") }
                    self.updateStatus()
                } catch { self.status("已检测网页状态，但钥匙串保存失败；本次关闭助手后可能需要重新登录。") }
            }
        }
    }

    private func confirm(_ title: String, message: String, action: @escaping () -> Void) {
        showWindow()
        guard window.attachedSheet == nil else { return }
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "确认")
        alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { response in
            if response == .alertFirstButtonReturn { action() }
        }
    }

    @objc private func clearLogin() {
        confirm("清除本机登录？", message: "删除助手钥匙串和本窗口中的豆包 Cookie。不会操作你现有浏览器，也不等于撤销豆包服务器上的所有会话。") {
            self.clearing = true
            self.cookieEpoch += 1
            self.snapshotWork?.cancel()
            self.cookies = []
            do { try self.keychain.delete("session") } catch {
                self.clearing = false
                self.status("钥匙串删除失败，未完成清除。请检查系统钥匙串权限。")
                return
            }
            // Destroy the old page before clearing, so its scripts cannot recreate cookies.
            self.webView.stopLoading()
            self.webView.loadHTMLString("", baseURL: nil)
        }
    }

    @objc private func revokePairing() {
        confirm("撤销全部 Bob 配对？", message: "下次 Bob 请求时需要重新确认配对。豆包网页登录状态保持不变。") {
            do {
                try self.keychain.delete("bridge-token")
                self.bridgeToken = ""
                self.pairing.pending = nil
                self.status("已撤销配对。下次在 Bob 点击验证时重新确认。")
            } catch { self.status("钥匙串删除失败，未撤销配对。") }
        }
    }

    private func presentPair(_ pair: PendingPair) {
        guard presentedPair != pair.id else { return }
        showWindow()
        guard window.attachedSheet == nil else { return }
        presentedPair = pair.id
        let alert = NSAlert()
        alert.messageText = "允许本机客户端连接？配对码 \(pair.code)"
        alert.informativeText = "请先查看 Bob 验证结果，确认两边都是 \(pair.code)。只有刚刚主动在 Bob 发起验证时才允许。\n\n允许后，该客户端可读取本助手的豆包登录 Cookie，并以你的账号发起请求。此授权只保存在本机；可从菜单撤销。"
        alert.addButton(withTitle: "核对一致，允许配对")
        alert.addButton(withTitle: "拒绝")
        alert.beginSheetModal(for: window) { result in
            self.pairing.approve(pair.id, allow: result == .alertFirstButtonReturn)
            self.status(result == .alertFirstButtonReturn
                        ? "已允许配对。请回 Bob 再点一次「验证」。"
                        : "已拒绝配对，没有发出登录凭证。")
        }
    }

    private func route(_ request: HTTPRequest, reply: @escaping (HTTPReply) -> Void) {
        func send(_ status: Int, _ data: [String: Any]) { reply(HTTPReply(status: status, json: data)) }
        if request.method == "GET" && request.path == "/health" {
            send(200, ["app": "doubao-bob-login-helper", "version": "0.2.0"]); return
        }
        if request.method == "POST" && request.path == "/v1/pair/start" {
            guard let clientId = request.json["clientId"] as? String,
                  clientId.range(of: #"^\d{18}$"#, options: .regularExpression) != nil else {
                send(400, ["error": "invalid_client"]); return
            }
            do {
                guard let pair = try pairing.begin(clientId: clientId) else {
                    send(429, ["error": "pairing_busy"]); return
                }
                send(202, ["requestId": pair.id, "code": pair.code])
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.presentPair(pair) }
            } catch { send(503, ["error": "pairing_unavailable"]) }
            return
        }
        if request.method == "POST" && request.path == "/v1/pair/claim" {
            guard let id = request.json["requestId"] as? String, let pair = pairing.pending,
                  BridgePolicy.constantEqual(id, pair.id), pair.expires > Date() else {
                send(410, ["error": "pairing_expired"]); return
            }
            if pair.denied { send(403, ["error": "pairing_denied"]); return }
            guard pair.approved else { send(202, ["error": "approval_required"]); return }
            do {
                if bridgeToken.isEmpty {
                    let token = try BridgePolicy.randomHex()
                    try keychain.write("bridge-token", data: Data(token.utf8))
                    bridgeToken = token
                }
                send(200, ["token": bridgeToken])
            } catch { send(503, ["error": "keychain_unavailable"]) }
            return
        }
        guard !bridgeToken.isEmpty,
              BridgePolicy.constantEqual(request.headers["authorization"] ?? "", "Bearer " + bridgeToken) else {
            send(401, ["error": "unauthorized"]); return
        }
        if request.method == "GET" && request.path == "/v1/session" {
            pairing.pending = nil
            guard let cookie = BridgePolicy.cookieHeader(cookies), !clearing else {
                showWindow()
                send(409, ["error": "login_required"]); return
            }
            send(200, ["cookie": cookie, "userAgent": userAgent])
        } else if request.method == "POST" && request.path == "/v1/login" {
            reloadLogin()
            send(200, ["opened": true])
        } else { send(404, ["error": "not_found"]) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if clearing {
            webView.configuration.websiteDataStore.removeData(
                ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast
            ) {
                DispatchQueue.main.async {
                    self.clearing = false
                    self.reloadLogin()
                    self.updateStatus()
                }
            }
            return
        }
        if let url = webView.url {
            addressLabel.stringValue = "当前官方页面：https://" + (url.host ?? "") + url.path
        }
        webView.evaluateJavaScript("navigator.userAgent") { [weak self] value, _ in
            if let value = value as? String, value.utf8.count <= 1024 { self?.userAgent = value }
            self?.snapshotCookies()
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        status("官方网页加载失败，请检查网络后点击「打开 / 刷新官网」。若官网不支持此登录窗口，可用手动 Cookie 模式。")
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.absoluteString == "about:blank" { decisionHandler(.allow); return }
        guard url.scheme == "https" else { decisionHandler(.cancel); return }
        if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
        guard BridgePolicy.isDoubaoDomain(url.host ?? "") else {
            status("已阻止主窗口跳转到非豆包域名。请使用豆包页面提供的扫码或手机号登录；若不兼容，可退回手动模式。")
            decisionHandler(.cancel); return
        }
        if action.targetFrame == nil {
            webView.load(action.request)
            decisionHandler(.cancel)
        } else { decisionHandler(.allow) }
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.deny)
    }
}

if CommandLine.arguments.contains("--version") {
    print("Doubao Login Helper 0.2.0")
} else {
    let application = NSApplication.shared
    let delegate = AppDelegate()
    application.setActivationPolicy(.accessory)
    application.delegate = delegate
    application.run()
}
