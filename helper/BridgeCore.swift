import Foundation
import Security

enum BridgeFailure: Error { case invalid, oversized, keychain(OSStatus), entropy }

enum BridgePolicy {
    static let port: UInt16 = 17643
    static let client = "bob-plugin-v1"
    static let maxHeader = 16384
    static let maxBody = 4096
    static let translationPath = "/samantha/plugin/stream_article_translate"

    static func randomHex(_ count: Int = 32) throws -> String {
        var bytes = [UInt8](repeating: 0, count: count)
        guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else {
            throw BridgeFailure.entropy
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    static func constantEqual(_ lhs: String, _ rhs: String) -> Bool {
        let a = Array(lhs.utf8), b = Array(rhs.utf8)
        guard a.count == b.count else { return false }
        var difference: UInt8 = 0
        for index in a.indices { difference |= a[index] ^ b[index] }
        return difference == 0
    }

    static func isDoubaoDomain(_ domain: String) -> Bool {
        let host = domain.lowercased().hasPrefix(".") ? String(domain.dropFirst()).lowercased() : domain.lowercased()
        return host == "doubao.com" || host == "www.doubao.com"
    }

    static func pathMatches(_ path: String, _ target: String = translationPath) -> Bool {
        target == path || (target.hasPrefix(path) && (path.hasSuffix("/") || target.dropFirst(path.count).hasPrefix("/")))
    }

    static func selectedCookies(_ cookies: [HTTPCookie], now: Date = Date()) -> [HTTPCookie] {
        cookies.filter {
            [".doubao.com", "www.doubao.com", ".www.doubao.com"].contains($0.domain.lowercased()) &&
            pathMatches($0.path) &&
            ($0.expiresDate == nil || $0.expiresDate! > now) &&
            $0.name.range(of: #"^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$"#, options: .regularExpression) != nil &&
            $0.value.range(of: #"^[\x21-\x3a\x3c-\x7e]*$"#, options: .regularExpression) != nil
        }.sorted { $0.path.count > $1.path.count }
    }

    static func hasSession(_ cookies: [HTTPCookie]) -> Bool {
        selectedCookies(cookies).contains {
            ["sessionid", "sessionid_ss", "sid_tt"].contains($0.name) && !$0.value.isEmpty
        }
    }

    static func cookieHeader(_ cookies: [HTTPCookie]) -> String? {
        guard hasSession(cookies) else { return nil }
        let header = selectedCookies(cookies).map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
        return header.utf8.count <= 32768 ? header : nil
    }

    static func accepts(_ request: HTTPRequest) -> Bool {
        request.headers["host"] == "127.0.0.1:\(port)" &&
        request.headers["x-doubao-bob-client"] == client &&
        request.headers["origin"] == nil &&
        !request.headers.keys.contains(where: { $0.hasPrefix("sec-fetch-") })
    }
}

struct HTTPRequest {
    let method: String
    let path: String
    let headers: [String: String]
    let body: Data

    var json: [String: Any] { (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:] }

    static func parse(_ data: Data) throws -> HTTPRequest? {
        let separator = Data([13, 10, 13, 10])
        guard let boundary = data.range(of: separator) else {
            if data.count > BridgePolicy.maxHeader { throw BridgeFailure.oversized }
            return nil
        }
        guard boundary.lowerBound <= BridgePolicy.maxHeader,
              let text = String(data: data[..<boundary.lowerBound], encoding: .ascii) else {
            throw BridgeFailure.invalid
        }
        let lines = text.components(separatedBy: "\r\n")
        let first = lines[0].components(separatedBy: " ")
        guard first.count == 3, ["GET", "POST", "OPTIONS"].contains(first[0]),
              first[1].hasPrefix("/"), !first[1].contains("?"),
              first[2] == "HTTP/1.1" else { throw BridgeFailure.invalid }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { throw BridgeFailure.invalid }
            let name = String(line[..<colon]).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            guard name.range(of: #"^[a-z0-9-]+$"#, options: .regularExpression) != nil,
                  !value.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }),
                  headers[name] == nil else { throw BridgeFailure.invalid }
            headers[name] = value
        }
        guard headers["transfer-encoding"] == nil else { throw BridgeFailure.invalid }
        let lengthText = headers["content-length"] ?? "0"
        guard lengthText.range(of: #"^\d+$"#, options: .regularExpression) != nil,
              let length = Int(lengthText), length <= BridgePolicy.maxBody else { throw BridgeFailure.oversized }
        let total = boundary.upperBound + length
        if data.count < total { return nil }
        guard data.count == total, first[0] == "POST" || length == 0 else { throw BridgeFailure.invalid }
        return HTTPRequest(method: first[0], path: first[1], headers: headers, body: data[boundary.upperBound..<total])
    }
}

struct HTTPReply {
    let status: Int
    let json: [String: Any]
    var data: Data {
        let body = (try? JSONSerialization.data(withJSONObject: json, options: [.sortedKeys])) ?? Data("{}".utf8)
        let head = "HTTP/1.1 \(status) Response\r\nContent-Type: application/json; charset=utf-8\r\n" +
            "Content-Length: \(body.count)\r\nCache-Control: no-store\r\n" +
            "X-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n"
        return Data(head.utf8) + body
    }
}

struct SavedCookie: Codable {
    let name: String
    let value: String
    let domain: String
    let path: String
    let secure: Bool
    let httpOnly: Bool
    let sameSite: String?
    let expires: Date?

    init(_ cookie: HTTPCookie) {
        name = cookie.name; value = cookie.value; domain = cookie.domain; path = cookie.path
        secure = cookie.isSecure; httpOnly = cookie.isHTTPOnly; expires = cookie.expiresDate
        sameSite = cookie.properties?[.sameSitePolicy] as? String
    }

    func restore() -> HTTPCookie? {
        guard BridgePolicy.isDoubaoDomain(domain), expires == nil || expires! > Date() else { return nil }
        var properties: [HTTPCookiePropertyKey: Any] = [.name: name, .value: value, .domain: domain, .path: path]
        if secure { properties[.secure] = "TRUE" }
        if httpOnly { properties[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
        if let sameSite { properties[.sameSitePolicy] = sameSite }
        if let expires { properties[.expires] = expires }
        guard let cookie = HTTPCookie(properties: properties), !httpOnly || cookie.isHTTPOnly else { return nil }
        return cookie
    }
}

struct SavedSession: Codable {
    let cookies: [SavedCookie]
    let userAgent: String
}

final class PrivateKeychain {
    private let service = "com.z2u35.doubaobob.login"
    private func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service, kSecAttrAccount as String: account]
    }
    func read(_ account: String) throws -> Data? {
        var request = query(account)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw BridgeFailure.keychain(status) }
        return result as? Data
    }
    func write(_ account: String, data: Data) throws {
        let values = [kSecValueData as String: data]
        var status = SecItemUpdate(query(account) as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            var item = query(account)
            item[kSecValueData as String] = data
            status = SecItemAdd(item as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw BridgeFailure.keychain(status) }
    }
    func delete(_ account: String) throws {
        let status = SecItemDelete(query(account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw BridgeFailure.keychain(status) }
    }
}

struct PendingPair {
    let id: String
    let code: String
    let clientId: String
    let expires: Date
    var approved = false
    var denied = false
}

final class PairingState {
    var pending: PendingPair?
    private var lastStart = Date.distantPast

    func begin(clientId: String, now: Date = Date()) throws -> PendingPair? {
        if let current = pending, current.expires > now, !current.denied {
            return current.clientId == clientId ? current : nil
        }
        guard now.timeIntervalSince(lastStart) >= 10 else { return nil }
        let random = try BridgePolicy.randomHex()
        let number = UInt32(random.prefix(8), radix: 16) ?? 0
        let pair = PendingPair(id: random, code: String(format: "%06u", number % 1000000),
                               clientId: clientId, expires: now.addingTimeInterval(180))
        pending = pair
        lastStart = now
        return pair
    }
    func approve(_ id: String, allow: Bool, now: Date = Date()) {
        guard var current = pending, current.id == id, current.expires > now else { return }
        current.approved = allow; current.denied = !allow
        pending = current
    }
}
