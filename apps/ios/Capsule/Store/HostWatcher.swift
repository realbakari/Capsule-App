import Foundation
import Observation

/*
 * The computers you aren't looking at. Each paired computer other than the
 * active one keeps its own connection, so an approval on your other Mac
 * still reaches you: it notifies, counts toward the badge in the computer
 * menu, and can be answered from the notification without switching.
 *
 * A watcher keeps only what that needs (threads, latest runs, pending
 * approvals). Opening one of its threads makes that computer the active one.
 */
@Observable
final class HostWatcher {
    let hostID: UUID
    private(set) var threads: [ChatThread] = []
    private(set) var latestRuns: [String: Run] = [:]
    private(set) var pendingApprovals: [Approval] = []
    private(set) var isConnected = false
    private(set) var canControl = false

    @ObservationIgnored private let connection: Connection
    @ObservationIgnored private var listener: Task<Void, Never>?
    @ObservationIgnored private let notifier: Notifier
    @ObservationIgnored private var answered: Set<String> = []

    init(host: PairedHost, token: String, notifier: Notifier) {
        hostID = host.id
        self.notifier = notifier
        connection = Connection(host: host, token: token)
    }

    var needsYou: Int { pendingApprovals.count }
    var working: Int { latestRuns.values.filter { $0.status.isLive && $0.status != .approvalRequired }.count }

    func start() {
        listener = Task { [weak self, connection] in
            for await signal in connection.signals {
                guard let self else { return }
                await self.handle(signal)
            }
        }
        Task { await connection.start() }
    }

    func stop() async {
        listener?.cancel()
        listener = nil
        await connection.stop()
        isConnected = false
    }

    /// Answers an approval on this computer, once.
    func resolve(approvalID: String, _ decision: Workspace.Decision) async -> Bool {
        guard canControl, answered.insert(approvalID).inserted else { return false }
        do {
            _ = try await connection.call("resolveApproval", [.string(approvalID), .string(decision.rawValue)])
            pendingApprovals.removeAll { $0.id == approvalID }
            return true
        } catch {
            return false
        }
    }

    private func handle(_ signal: Signal) async {
        switch signal {
        case .state(let state):
            if case .ready(let scopes) = state {
                isConnected = true
                canControl = scopes.contains("control") || scopes.contains("write")
                await refresh(notifyNew: true)
            } else {
                isConnected = false
            }
        case .event(let event):
            apply(event)
        default:
            break
        }
    }

    private func refresh(notifyNew: Bool) async {
        async let threads = connection.call("listSessions", as: [ChatThread].self)
        async let runs = connection.call("listLatestRuns", as: [Run].self)
        async let approvals = connection.call("listApprovals", [.string("pending")], as: [Approval].self)
        guard let threads = try? await threads, let runs = try? await runs, let approvals = try? await approvals else { return }
        let known = Set(pendingApprovals.map(\.id))
        self.threads = threads
        latestRuns = Dictionary(runs.map { ($0.sessionId, $0) }, uniquingKeysWith: { $0.createdAt >= $1.createdAt ? $0 : $1 })
        pendingApprovals = approvals
        guard notifyNew else { return }
        for approval in approvals where !known.contains(approval.id) { notify(approval) }
    }

    private func apply(_ event: ServerEvent) {
        switch event {
        case .run(let run):
            let previous = latestRuns[run.sessionId]
            if previous == nil || previous!.createdAt <= run.createdAt { latestRuns[run.sessionId] = run }
            if previous?.status.isLive == true, !run.status.isLive {
                notifier.runSettled(run, thread: thread(run.sessionId), visible: false, hostID: hostID)
            }
        case .approval(let approval):
            pendingApprovals.removeAll { $0.id == approval.id }
            if approval.status == .pending {
                pendingApprovals.append(approval)
                notify(approval)
            }
        case .state:
            Task { await refresh(notifyNew: false) }
        default:
            break
        }
    }

    private func notify(_ approval: Approval) {
        let sessionID = latestRuns.values.first { $0.id == approval.runId }?.sessionId
        notifier.approvalRequested(approval, thread: sessionID.flatMap(thread), visible: false, hostID: hostID)
    }

    func thread(_ id: String) -> ChatThread? { threads.first { $0.id == id } }
}
