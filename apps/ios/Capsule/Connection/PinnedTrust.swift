import CryptoKit
import Foundation
import Security

/*
 * Trust for a paired computer.
 *
 * A pinned pairing accepts exactly one certificate: the one whose SHA-256
 * matches the fingerprint in the pairing code. The system's CA list is not
 * consulted, because the desktop's certificate is self-signed and the code
 * scanned off its screen is a better root of trust than any CA could be.
 * Anything else — system-validated HTTPS, plain HTTP — follows the default.
 */
nonisolated final class PinnedTrust: NSObject, URLSessionDelegate, URLSessionTaskDelegate, Sendable {
    let fingerprint: String?

    init(fingerprint: String?) {
        self.fingerprint = fingerprint
    }

    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge)
        async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        decide(challenge)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge)
        async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        decide(challenge)
    }

    private func decide(_ challenge: URLAuthenticationChallenge) -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust else {
            return (.performDefaultHandling, nil)
        }
        guard let fingerprint else { return (.performDefaultHandling, nil) }
        guard let leaf = (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first,
              Self.fingerprint(of: leaf) == fingerprint else {
            return (.cancelAuthenticationChallenge, nil)
        }
        return (.useCredential, URLCredential(trust: trust))
    }

    static func fingerprint(of certificate: SecCertificate) -> String {
        let der = SecCertificateCopyData(certificate) as Data
        return SHA256.hash(data: der).map { String(format: "%02x", $0) }.joined()
    }

    /// A session that applies this trust to every request and socket it opens.
    func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.waitsForConnectivity = false
        config.httpCookieStorage = nil
        config.urlCache = nil
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }
}
