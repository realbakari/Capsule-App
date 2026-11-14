import Foundation

/*
 * One live connection to a paired computer.
 *
 * The protocol is the one the browser workspace speaks: the first frame
 * carries the bearer token (never the URL), the computer answers `ready`
 * with the scopes it granted, and from then on calls are `{id, channel,
 * args}` frames answered by `result`, with `event` frames in between.
 *
 * Two rules matter more than the rest:
 *  - A call in flight when the socket drops fails. It is never replayed on
 *    the next connection: it may have started a turn or resolved an
 *    approval already, and doing it twice is worse than asking again.
 *  - Close code 4401 means the pairing is over (revoked or expired). The
 *    connection stops retrying instead of hammering a door that is shut.
 */
nonisolated enum ConnectionState: Equatable, Sendable {
    case idle
    case connecting(attempt: Int)
    case ready(scopes: [String])
    case waiting(retryAt: Date, reason: String)
    case unauthorized
}

nonisolated enum ServerEvent: Sendable {
    case run(Run)
    case runEvent(RunEvent)
    case message(ChatMessage)
    case approval(Approval)
    case followUps(sessionID: String, FollowUps)
    case state
}

nonisolated enum Signal: Sendable {
    case state(ConnectionState)
    case event(ServerEvent)
    /// The computer extended the pairing; this is its new end.
    case renewed(Date)
    /// The address didn't answer at all (not a refusal or a bad certificate).
    case unreachable
    /// What the computer said about itself when it accepted the connection.
    case hello(version: String?, protocolVersion: Int)
}

nonisolated struct RemoteError: LocalizedError, Sendable {
    let message: String
    var errorDescription: String? { message }

    static let disconnected = RemoteError(message: String(localized: "Lost the connection to your computer. Check the thread before trying again — the request may have gone through."))
    static let notConnected = RemoteError(message: String(localized: "Not connected to your computer."))
    static let tooMany = RemoteError(message: String(localized: "Too many requests are waiting. Try again in a moment."))
}

actor Connection {
    private var host: PairedHost
    private let token: String
    private let trust: PinnedTrust
    private let session: URLSession
    private let continuation: AsyncStream<Signal>.Continuation
    nonisolated let signals: AsyncStream<Signal>

    private var task: URLSessionWebSocketTask?
    private var generation = 0
    private var nextID = 1
    private var pending: [Int: CheckedContinuation<Data, Error>] = [:]
    private var failures = 0
    private var stopped = true
    private var isReady = false
    private var retryTask: Task<Void, Never>?

    init(host: PairedHost, token: String) {
        self.host = host
        self.token = token
        self.trust = PinnedTrust(fingerprint: host.fingerprint)
        self.session = trust.makeSession()
        (signals, continuation) = AsyncStream.makeStream(bufferingPolicy: .bufferingNewest(512))
    }

    deinit {
        continuation.finish()
        session.invalidateAndCancel()
    }

    // MARK: Lifecycle

    func start() {
        guard stopped else { return }
        stopped = false
        connect()
    }

    /// Closes the socket and stops retrying. Pending calls fail.
    func stop() {
        stopped = true
        retryTask?.cancel()
        retryTask = nil
        drop(error: RemoteError.disconnected, emit: .idle)
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    /// Points at a new address (found by discovery or typed in) and tries it now.
    func relocate(to newHost: PairedHost) {
        host = newHost
        guard !stopped else { return }
        retryTask?.cancel()
        failures = 0
        connect()
    }

    /// Skips the backoff, for when the network or the app just came back.
    func reconnectNow() {
        guard !stopped, !isReady else { return }
        retryTask?.cancel()
        failures = 0
        connect()
    }

    private func connect() {
        task?.cancel(with: .goingAway, reason: nil)
        generation += 1
        let current = generation
        isReady = false
        continuation.yield(.state(.connecting(attempt: failures + 1)))

        var request = URLRequest(url: host.socketURL)
        request.timeoutInterval = 15
        if let origin = host.originHeader { request.setValue(origin, forHTTPHeaderField: "origin") }
        let socket = session.webSocketTask(with: request)
        socket.maximumMessageSize = 32 * 1024 * 1024
        task = socket
        socket.resume()

        Task { await self.handshake(socket, generation: current) }
    }

    private func handshake(_ socket: URLSessionWebSocketTask, generation current: Int) async {
        do {
            let hello = try JSONSerialization.data(withJSONObject: ["token": token])
            try await socket.send(.string(String(decoding: hello, as: UTF8.self)))
        } catch {
            await lost(socket, generation: current, error: error)
            return
        }
        // The computer must answer within ten seconds or the attempt is over.
        let timeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(10))
            guard !Task.isCancelled else { return }
            await self?.handshakeTimedOut(socket, generation: current)
        }
        await receiveLoop(socket, generation: current, timeout: timeout)
    }

    private func handshakeTimedOut(_ socket: URLSessionWebSocketTask, generation current: Int) {
        guard current == generation, !isReady else { return }
        socket.cancel(with: .goingAway, reason: nil)
    }

    private func receiveLoop(_ socket: URLSessionWebSocketTask, generation current: Int, timeout: Task<Void, Never>) async {
        defer { timeout.cancel() }
        while current == generation {
            let message: URLSessionWebSocketTask.Message
            do {
                message = try await socket.receive()
            } catch {
                await lost(socket, generation: current, error: error)
                return
            }
            let data: Data
            switch message {
            case .string(let text): data = Data(text.utf8)
            case .data(let bytes): data = bytes
            @unknown default: continue
            }
            if handle(frame: data, timeout: timeout) == false {
                socket.cancel(with: .protocolError, reason: nil)
                await lost(socket, generation: current, error: RemoteError.disconnected)
                return
            }
        }
    }

    /// Returns false when the frame is unreadable, which ends the connection.
    private func handle(frame data: Data, timeout: Task<Void, Never>) -> Bool {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else { return false }
        switch type {
        case "ready":
            timeout.cancel()
            failures = 0
            isReady = true
            let scopes = object["scopes"] as? [String] ?? []
            if let expires = (object["expiresAt"] as? NSNumber)?.doubleValue {
                continuation.yield(.renewed(Date(timeIntervalSince1970: expires / 1000)))
            }
            continuation.yield(.hello(version: object["version"] as? String, protocolVersion: (object["protocol"] as? NSNumber)?.intValue ?? 0))
            continuation.yield(.state(.ready(scopes: scopes)))
            startKeepAlive(generation: generation)
        case "result":
            guard let id = (object["id"] as? NSNumber)?.intValue, let waiter = pending.removeValue(forKey: id) else { break }
            if let error = object["error"] as? String {
                waiter.resume(throwing: RemoteError(message: error))
            } else {
                let value = object["result"] ?? NSNull()
                let encoded = (try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])) ?? Data("null".utf8)
                waiter.resume(returning: encoded)
            }
        case "event":
            guard let name = object["event"] as? String, let payload = object["payload"] else { break }
            if let event = Self.decodeEvent(name: name, payload: payload) { continuation.yield(.event(event)) }
        default:
            break
        }
        return true
    }

    private static func decodeEvent(name: String, payload: Any) -> ServerEvent? {
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.fragmentsAllowed]) else { return nil }
        let decoder = JSONDecoder()
        switch name {
        case "capsule:event:run":
            // The run channel carries both run records and their log events.
            if let event = try? decoder.decode(RunEvent.self, from: data) { return .runEvent(event) }
            if let run = try? decoder.decode(Run.self, from: data) { return .run(run) }
            return nil
        case "capsule:event:message":
            return (try? decoder.decode(ChatMessage.self, from: data)).map(ServerEvent.message)
        case "capsule:event:approval":
            return (try? decoder.decode(Approval.self, from: data)).map(ServerEvent.approval)
        case "capsule:event:state":
            if let object = payload as? [String: Any], object["command"] as? String == "follow-ups-updated",
               let sessionID = object["sessionId"] as? String, let value = object["followUps"],
               let raw = try? JSONSerialization.data(withJSONObject: value),
               let followUps = try? decoder.decode(FollowUps.self, from: raw) {
                return .followUps(sessionID: sessionID, followUps)
            }
            return .state
        default:
            return nil
        }
    }

    private func startKeepAlive(generation current: Int) {
        Task { [weak self] in
            while true {
                try? await Task.sleep(for: .seconds(25))
                guard let self, await self.ping(generation: current) else { return }
            }
        }
    }

    /// A ping that goes unanswered means the socket is dead even if iOS hasn't said so.
    private func ping(generation current: Int) async -> Bool {
        guard current == generation, isReady, let socket = task else { return false }
        let answered: Bool = await withCheckedContinuation { done in
            let once = Once()
            socket.sendPing { error in if once.claim() { done.resume(returning: error == nil) } }
            Task {
                try? await Task.sleep(for: .seconds(10))
                if once.claim() { done.resume(returning: false) }
            }
        }
        if !answered, current == generation {
            socket.cancel(with: .goingAway, reason: nil)
            await lost(socket, generation: current, error: RemoteError.disconnected)
            return false
        }
        return true
    }

    private func lost(_ socket: URLSessionWebSocketTask, generation current: Int, error: Error) async {
        guard current == generation else { return }
        generation += 1
        task = nil
        isReady = false
        if socket.closeCode.rawValue == 4401 {
            stopped = true
            drop(error: RemoteError(message: String(localized: "This pairing expired or was removed on your computer. Pair again to continue.")), emit: .unauthorized)
            return
        }
        guard !stopped else { drop(error: RemoteError.disconnected, emit: .idle); return }
        let delay = Self.backoff(failures: failures)
        failures += 1
        let reason = Self.describe(error, closeCode: socket.closeCode)
        drop(error: RemoteError.disconnected, emit: .waiting(retryAt: .now + delay, reason: reason))
        if let url = error as? URLError, [.cannotConnectToHost, .cannotFindHost, .timedOut, .networkConnectionLost].contains(url.code) {
            continuation.yield(.unreachable)
        }
        retryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            await self?.retry()
        }
    }

    private func retry() {
        guard !stopped, !isReady else { return }
        connect()
    }

    private func drop(error: Error, emit state: ConnectionState) {
        isReady = false
        let waiting = pending
        pending.removeAll()
        for waiter in waiting.values { waiter.resume(throwing: error) }
        continuation.yield(.state(state))
    }

    /// 1.5 s doubling to 30 s, with jitter so several phones don't retry in step.
    static func backoff(failures: Int) -> Double {
        let base = min(30, 1.5 * pow(2, Double(min(failures, 5))))
        return base * Double.random(in: 0.8...1.2)
    }

    private static func describe(_ error: Error, closeCode: URLSessionWebSocketTask.CloseCode) -> String {
        if closeCode.rawValue == 1013 { return String(localized: "This device fell behind; refreshing.") }
        if closeCode == .goingAway { return String(localized: "Your computer closed the connection.") }
        if let url = error as? URLError {
            switch url.code {
            case .notConnectedToInternet, .networkConnectionLost: return String(localized: "No network connection.")
            case .cannotConnectToHost, .cannotFindHost, .timedOut: return String(localized: "Can't reach your computer.")
            case .cancelled, .serverCertificateUntrusted, .secureConnectionFailed:
                return String(localized: "Couldn't verify your computer's identity.")
            default: break
            }
        }
        return String(localized: "Connection lost.")
    }

    // MARK: Calls

    func call(_ channel: String, _ args: [JSONValue] = [], timeout: Duration = .seconds(30)) async throws -> Data {
        guard isReady, let socket = task else { throw RemoteError.notConnected }
        guard pending.count < 64 else { throw RemoteError.tooMany }
        let id = nextID
        nextID += 1
        struct Frame: Encodable { let id: Int; let channel: String; let args: [JSONValue] }
        let frame = try JSONEncoder().encode(Frame(id: id, channel: channel, args: args))
        let current = generation
        // A reply that never comes must not leave a spinner forever.
        Task { [weak self] in
            try? await Task.sleep(for: timeout)
            await self?.expire(id: id)
        }
        return try await withCheckedThrowingContinuation { waiter in
            pending[id] = waiter
            Task {
                do {
                    try await socket.send(.string(String(decoding: frame, as: UTF8.self)))
                } catch {
                    self.failSend(id: id, generation: current)
                }
            }
        }
    }

    private func expire(id: Int) {
        pending.removeValue(forKey: id)?.resume(throwing: RemoteError(message: String(localized: "Your computer took too long to answer. Try again.")))
    }

    private func failSend(id: Int, generation current: Int) {
        pending.removeValue(forKey: id)?.resume(throwing: RemoteError.disconnected)
    }

    func call<T: Decodable & Sendable>(_ channel: String, _ args: [JSONValue] = [], as type: T.Type, timeout: Duration = .seconds(30)) async throws -> T {
        let data = try await call(channel, args, timeout: timeout)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw RemoteError(message: String(localized: "Your computer sent data this app doesn't understand (\(channel)). Update Capsule on your computer and on this device."))
        }
    }
}

/// A flag that can be claimed once, from any thread.
nonisolated final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    func claim() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if done { return false }
        done = true
        return true
    }
}
