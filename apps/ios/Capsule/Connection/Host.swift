import Foundation
import UIKit

/*
 * A paired computer. Everything here is safe to keep in defaults and the
 * cache; the bearer token is kept in the Keychain under `id`.
 */
nonisolated struct PairedHost: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    var name: String
    var host: String
    var port: Int
    /// SHA-256 of the computer's certificate, for pinned pairings.
    var fingerprint: String?
    var usesTLS: Bool
    var scopes: [String]
    var pairedAt: Date
    var expiresAt: Date

    var canControl: Bool { scopes.contains("control") || scopes.contains("write") }
    var isExpired: Bool { expiresAt <= .now }

    var baseURL: URL {
        var c = URLComponents()
        c.scheme = usesTLS ? "https" : "http"
        c.host = host
        c.port = port
        return c.url!
    }

    var socketURL: URL {
        var c = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        c.scheme = usesTLS ? "wss" : "ws"
        c.path = "/rpc"
        return c.url!
    }

    /// Browser-style links are checked against the page origin they name. A
    /// pinned pairing is a native client and sends none.
    var originHeader: String? {
        fingerprint == nil ? baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) : nil
    }

    var security: PairingLink.Security {
        if let fingerprint { return .pinned(fingerprint: fingerprint) }
        return usesTLS ? .systemTLS : .plaintext
    }

    var securitySummary: LocalizedStringResource {
        switch security {
        case .pinned: "Encrypted, verified by pairing code"
        case .systemTLS: "Encrypted (HTTPS)"
        case .plaintext: "Not encrypted — reading only"
        }
    }
}

/// Trades a one-time pairing token for a session on the computer.
nonisolated enum Pairing {
    enum Failure: LocalizedError {
        case rejected(String), unreachable(String), untrusted, malformed

        var errorDescription: String? {
            switch self {
            case .rejected(let reason):
                switch reason {
                case "consumed": String(localized: "This pairing code was already used. Create a new one on your computer.")
                case "expired": String(localized: "This pairing code expired. Codes last five minutes — create a new one on your computer.")
                default: String(localized: "Your computer didn't accept this pairing code. Create a new one and try again.")
                }
            case .unreachable(let detail):
                String(localized: "Couldn't reach your computer. Check that Capsule is open and that this device is on the same network. (\(detail))")
            case .untrusted:
                String(localized: "The computer's security certificate doesn't match the pairing code. Nothing was sent. Create a new code on your computer.")
            case .malformed:
                String(localized: "Your computer sent a reply this app doesn't understand. Update Capsule on your computer.")
            }
        }
    }

    private struct Request: Encodable { let token: String; let label: String }
    private struct Response: Decodable { let token: String; let scopes: [String]; let expiresAt: Double }

    @MainActor static var deviceLabel: String {
        let idiom = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        return "Capsule for \(idiom)"
    }

    static func exchange(_ link: PairingLink, label: String) async throws -> (PairedHost, String) {
        let fingerprint: String? = if case .pinned(let fp) = link.security { fp } else { nil }
        let trust = PinnedTrust(fingerprint: fingerprint)
        let session = trust.makeSession()
        defer { session.finishTasksAndInvalidate() }

        var request = URLRequest(url: link.baseURL.appending(path: "pair"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        if fingerprint == nil {
            request.setValue(link.baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
                             forHTTPHeaderField: "origin")
        }
        request.httpBody = try JSONEncoder().encode(Request(token: link.token, label: label))

        let data: Data, response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code == .cancelled || error.code == .serverCertificateUntrusted
            || error.code == .secureConnectionFailed || error.code == .serverCertificateHasUnknownRoot {
            throw fingerprint == nil ? Failure.unreachable(error.localizedDescription) : Failure.untrusted
        } catch {
            throw Failure.unreachable(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw Failure.malformed }
        guard http.statusCode == 200 else {
            let reason = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? "unknown"
            throw Failure.rejected(reason)
        }
        guard let body = try? JSONDecoder().decode(Response.self, from: data), !body.token.isEmpty else {
            throw Failure.malformed
        }
        let host = PairedHost(
            id: UUID(),
            name: link.hostName ?? link.host,
            host: link.host,
            port: link.port,
            fingerprint: fingerprint,
            usesTLS: link.security != .plaintext,
            scopes: body.scopes,
            pairedAt: .now,
            expiresAt: Date(timeIntervalSince1970: body.expiresAt / 1000)
        )
        return (host, body.token)
    }
}
