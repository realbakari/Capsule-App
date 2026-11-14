import Foundation
import Network

/*
 * Finding a paired computer again after its address changed.
 *
 * The computer advertises `_capsule._tcp` on the local network with the
 * first 16 hex characters of its certificate fingerprint in the TXT record.
 * A match here is only a hint about where to look: the connection that
 * follows still has to present the pinned certificate before the token is
 * sent, so a spoofed advert gets nothing.
 */
nonisolated enum Discovery {
    static let serviceType = "_capsule._tcp"

    struct Found: Equatable, Sendable {
        let host: String
        let port: Int
    }

    /// Browses for up to `timeout`, returning the address of the advert
    /// whose fingerprint prefix matches, or nil.
    static func find(fingerprint: String, timeout: Duration = .seconds(5)) async -> Found? {
        let prefix = String(fingerprint.prefix(16)).lowercased()
        let endpoint: NWEndpoint? = await withCheckedContinuation { done in
            let once = Once()
            let browser = NWBrowser(for: .bonjourWithTXTRecord(type: serviceType, domain: nil), using: .tcp)
            let queue = DispatchQueue(label: "capsule.discovery")
            browser.browseResultsChangedHandler = { results, _ in
                for result in results {
                    guard case .bonjour(let txt) = result.metadata,
                          txt["fp"]?.lowercased() == prefix else { continue }
                    if once.claim() { browser.cancel(); done.resume(returning: result.endpoint) }
                    return
                }
            }
            browser.stateUpdateHandler = { state in
                if case .failed = state, once.claim() { browser.cancel(); done.resume(returning: nil) }
            }
            browser.start(queue: queue)
            queue.asyncAfter(deadline: .now() + .milliseconds(Int(timeout.components.seconds * 1000))) {
                if once.claim() { browser.cancel(); done.resume(returning: nil) }
            }
        }
        guard let endpoint else { return nil }
        return await resolve(endpoint)
    }

    /// A service name resolves to an address by connecting to it briefly.
    /// IPv4 only: a link-local IPv6 address needs a zone the URL can't carry.
    private static func resolve(_ endpoint: NWEndpoint) async -> Found? {
        let parameters = NWParameters.tcp
        if let ip = parameters.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options {
            ip.version = .v4
        }
        let connection = NWConnection(to: endpoint, using: parameters)
        let queue = DispatchQueue(label: "capsule.discovery.resolve")
        return await withCheckedContinuation { done in
            let once = Once()
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    var found: Found?
                    if case .hostPort(let host, let port)? = connection.currentPath?.remoteEndpoint {
                        let name: String? = switch host {
                        case .ipv4(let address): "\(address)".components(separatedBy: "%").first
                        case .name(let name, _): name
                        default: nil
                        }
                        if let name { found = Found(host: name, port: Int(port.rawValue)) }
                    }
                    if once.claim() { connection.cancel(); done.resume(returning: found) }
                case .failed, .cancelled:
                    if once.claim() { done.resume(returning: nil) }
                default:
                    break
                }
            }
            connection.start(queue: queue)
            queue.asyncAfter(deadline: .now() + 4) {
                if once.claim() { connection.cancel(); done.resume(returning: nil) }
            }
        }
    }
}
