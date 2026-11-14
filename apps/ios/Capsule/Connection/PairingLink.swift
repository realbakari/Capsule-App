import Foundation

/*
 * What a pairing code or link says.
 *
 * Two forms are accepted:
 *
 * - `capsule://pair?host=…&port=…&fp=…&token=…&name=…` — the code the
 *   desktop shows for a phone. The connection is TLS, and `fp` is the
 *   SHA-256 of the desktop's own certificate: the app trusts that one
 *   certificate and nothing else, so no certificate authority is involved
 *   and nobody on the network can stand in for the computer.
 * - `http(s)://host:port/#pair=…` — the browser link. Over plain HTTP the
 *   desktop grants reading only; over its HTTPS address it decides by the
 *   pairing's own scope.
 */
nonisolated struct PairingLink: Equatable, Sendable {
    enum Security: Equatable, Sendable {
        /// TLS, trusting only the certificate with this SHA-256 fingerprint.
        case pinned(fingerprint: String)
        /// TLS validated by the system (an HTTPS address configured on the host).
        case systemTLS
        /// No transport security. The desktop limits these to reading.
        case plaintext
    }

    var host: String
    var port: Int
    var token: String
    var security: Security
    var hostName: String?

    var baseURL: URL {
        var c = URLComponents()
        c.scheme = security == .plaintext ? "http" : "https"
        c.host = host
        c.port = port
        return c.url!
    }

    enum ParseError: LocalizedError, Equatable {
        case notAPairingLink, missingToken, badHost, badFingerprint

        var errorDescription: String? {
            switch self {
            case .notAPairingLink: String(localized: "That isn't a Capsule pairing code. On your computer, open Settings → Gateway → Browser access and create a new one.")
            case .missingToken: String(localized: "The pairing code is incomplete. Create a new one on your computer.")
            case .badHost: String(localized: "The pairing code doesn't include a valid computer address.")
            case .badFingerprint: String(localized: "The pairing code's security fingerprint is invalid. Create a new one on your computer.")
            }
        }
    }

    static func parse(_ raw: String) throws(ParseError) -> PairingLink {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: text), let scheme = url.scheme?.lowercased() else { throw .notAPairingLink }

        if scheme == "capsule" {
            guard url.host == "pair" || url.path == "pair" || url.path == "/pair" else { throw .notAPairingLink }
            // The desktop writes the query with form encoding, where a space is "+".
            // Token, host and fingerprint never contain "+", so decoding it is safe.
            let formQuery = url.query?.replacingOccurrences(of: "+", with: "%20")
            var components = URLComponents()
            components.percentEncodedQuery = formQuery
            let items = components.queryItems ?? []
            func value(_ name: String) -> String? {
                items.first { $0.name == name }?.value.flatMap { $0.isEmpty ? nil : $0 }
            }
            guard let token = value("token") else { throw .missingToken }
            guard let host = value("host"), isPlausibleHost(host),
                  let port = value("port").flatMap(Int.init), (1...65535).contains(port) else { throw .badHost }
            guard let fp = value("fp")?.lowercased().replacingOccurrences(of: ":", with: ""),
                  fp.count == 64, fp.allSatisfy(\.isHexDigit) else { throw .badFingerprint }
            return PairingLink(host: host, port: port, token: token, security: .pinned(fingerprint: fp), hostName: value("name"))
        }

        guard scheme == "http" || scheme == "https" else { throw .notAPairingLink }
        guard let fragment = url.fragment, fragment.hasPrefix("pair=") else { throw .notAPairingLink }
        let token = String(fragment.dropFirst("pair=".count)).trimmingCharacters(in: .whitespaces)
        guard !token.isEmpty else { throw .missingToken }
        guard let host = url.host, isPlausibleHost(host) else { throw .badHost }
        let port = url.port ?? (scheme == "https" ? 443 : 80)
        return PairingLink(host: host, port: port, token: token,
                           security: scheme == "https" ? .systemTLS : .plaintext, hostName: nil)
    }

    private static func isPlausibleHost(_ host: String) -> Bool {
        !host.isEmpty && host.count <= 253 && !host.contains(where: { $0.isWhitespace || $0 == "/" || $0 == "@" })
    }
}
