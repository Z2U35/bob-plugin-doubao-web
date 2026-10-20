import Foundation

@main
struct CoreTests {
    static var checks = 0
    static func check(_ value: Bool, _ label: String) {
        checks += 1
        guard value else { fatalError("FAILED: " + label) }
    }
    static func request(_ extra: String = "", path: String = "/health", body: String = "", method: String = "GET") -> Data {
        Data(("\(method) \(path) HTTP/1.1\r\nHost: 127.0.0.1:17643\r\n" +
              "X-Doubao-Bob-Client: bob-plugin-v1\r\nContent-Length: \(body.utf8.count)\r\n" +
              extra + "\r\n" + body).utf8)
    }
    static func cookie(_ name: String, domain: String = ".doubao.com", path: String = "/", expires: Date? = nil) -> HTTPCookie {
        var p: [HTTPCookiePropertyKey: Any] = [
            .name: name, .value: "SYNTHETIC_TEST_ONLY", .domain: domain, .path: path,
            .secure: "TRUE", HTTPCookiePropertyKey("HttpOnly"): "TRUE", .sameSitePolicy: "strict"
        ]
        if let expires { p[.expires] = expires }
        return HTTPCookie(properties: p)!
    }
    static func main() throws {
        check(BridgePolicy.constantEqual("abc", "abc"), "same token")
        check(!BridgePolicy.constantEqual("abc", "abd"), "different token")
        check(!BridgePolicy.constantEqual("abc", "ab"), "different length")
        check(try BridgePolicy.randomHex().count == 64, "random token length")
        let randomA = try BridgePolicy.randomHex(), randomB = try BridgePolicy.randomHex()
        check(randomA != randomB, "independent entropy")
        let valid = try HTTPRequest.parse(request())!
        check(BridgePolicy.accepts(valid), "native loopback accepted")
        check(!BridgePolicy.accepts(try HTTPRequest.parse(request("Origin: https://evil.example\r\n"))!), "browser rejected")
        check(!BridgePolicy.accepts(try HTTPRequest.parse(request("Origin: null\r\n"))!), "null origin rejected")
        check(!BridgePolicy.accepts(try HTTPRequest.parse(request("Sec-Fetch-Site: cross-site\r\n"))!), "fetch rejected")
        check(try HTTPRequest.parse(Data(request().dropLast())) == nil, "partial frame")
        let post = try HTTPRequest.parse(request(path: "/v1/pair/start", body: "{\"x\":1}", method: "POST"))!
        check(post.json["x"] as? Int == 1, "JSON request")
        for bad in [
            request("Host: evil.example\r\n"),
            request("Transfer-Encoding: chunked\r\n"),
            request(path: "/health?token=secret"),
            request("Content-Length: 9999999\r\n"),
            request() + request()
        ] {
            do { _ = try HTTPRequest.parse(bad); check(false, "invalid frame accepted") }
            catch { check(true, "invalid frame rejected") }
        }
        check(!BridgePolicy.isDoubaoDomain("www.doubao.com.evil.example"), "domain suffix attack")
        check(!BridgePolicy.isDoubaoDomain("evil.doubao.com"), "unrelated subdomain")
        check(BridgePolicy.isDoubaoDomain(".doubao.com"), "root domain cookie")
        check(!BridgePolicy.pathMatches("/samanth"), "path boundary")
        check(BridgePolicy.pathMatches("/samantha"), "path directory")
        let session = cookie("sessionid")
        check(session.isHTTPOnly, "HttpOnly constructor")
        let restored = SavedCookie(session).restore()!
        check(restored.isHTTPOnly && restored.isSecure, "HttpOnly and Secure preserved")
        check(restored.properties?[.sameSitePolicy] as? String == "strict", "SameSite preserved")
        check(BridgePolicy.cookieHeader([session])?.contains("sessionid=") == true, "session cookie selected")
        check(BridgePolicy.cookieHeader([cookie("sessionid", domain: ".evil.example")]) == nil, "foreign cookie excluded")
        check(BridgePolicy.cookieHeader([cookie("sessionid", domain: "doubao.com")]) == nil, "host-only root excluded for www")
        check(BridgePolicy.cookieHeader([cookie("sessionid", path: "/alice")]) == nil, "wrong path excluded")
        check(BridgePolicy.cookieHeader([cookie("sessionid", expires: .distantPast)]) == nil, "expired session excluded")
        check(BridgePolicy.cookieHeader([cookie("preference")]) == nil, "preference not login")
        let state = PairingState()
        let now = Date()
        let pair = try state.begin(clientId: "123456789123456789", now: now)!
        check(pair.id.count == 64 && pair.code.count == 6 && !pair.approved, "approval required")
        check(try state.begin(clientId: "223456789123456789", now: now) == nil, "concurrent pairing rejected")
        check(try state.begin(clientId: pair.clientId, now: now)?.id == pair.id, "same client retry")
        state.approve("wrong-id", allow: true)
        check(state.pending?.approved == false, "wrong request cannot approve")
        state.approve(pair.id, allow: true)
        check(state.pending?.approved == true, "explicit approval")
        state.approve(pair.id, allow: false, now: now.addingTimeInterval(181))
        check(state.pending?.denied == false, "expired approval ignored")
        let reply = String(data: HTTPReply(status: 200, json: ["ok": true]).data, encoding: .utf8)!
        check(reply.contains("Cache-Control: no-store"), "no caching")
        check(!reply.contains("Access-Control-Allow-Origin"), "no CORS")
        print("Helper core: \(checks) checks passed")
    }
}
