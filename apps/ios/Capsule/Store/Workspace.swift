import Foundation
import Network
import Observation
import SwiftUI

/*
 * Everything the app knows about the paired computer, and the one place
 * that talks to it.
 *
 * Reads come back as a fresh snapshot whenever the connection becomes ready,
 * so nothing missed while offline is stitched together from events. Writes
 * (send, stop, approve) go straight to the computer and are never queued for
 * later: if the connection is down, the user is told and decides again.
 */
@Observable
final class Workspace {
    private(set) var hosts: [PairedHost] = []
    private(set) var activeHostID: UUID?
    private(set) var connectionState: ConnectionState = .idle
    private(set) var grantedScopes: [String] = []

    private(set) var projects: [Project] = []
    private(set) var threads: [ChatThread] = []
    private(set) var latestRuns: [String: Run] = [:]
    private(set) var pendingApprovals: [Approval] = []
    private(set) var lastSynced: Date?
    private(set) var isSyncing = false
    var syncError: String?

    /// Threads on screen, one per window, so notifications skip what the user is reading.
    private(set) var visibleThreadIDs: Set<String> = []
    func isVisible(_ threadID: String?) -> Bool { threadID.map(visibleThreadIDs.contains) ?? false }
    func show(_ threadID: String) { visibleThreadIDs.insert(threadID) }
    func hide(_ threadID: String) { visibleThreadIDs.remove(threadID) }
    private(set) var lastViewed: [String: String] = [:]
    /// Set when the "while you were away" brief is dismissed; cleared when the app leaves again.
    var briefDismissed = false

    @ObservationIgnored private var connection: Connection?
    @ObservationIgnored private var listener: Task<Void, Never>?
    @ObservationIgnored private var threadModels: [String: ThreadModel] = [:]
    @ObservationIgnored private var cachedMessages: [String: [ChatMessage]] = [:]
    @ObservationIgnored private let pathMonitor = NWPathMonitor()
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored let notifier = Notifier()
    @ObservationIgnored let liveActivities = LiveActivities()
    @ObservationIgnored let widgetPublisher = WidgetPublisher()
    /// The latest step of each live turn, for the Live Activity, whether or not its thread is open.
    @ObservationIgnored var liveSteps: [String: String] = [:]

    init(preview: Bool = false) {
        guard !preview else { return }
        hosts = Persistence.loadHosts()
        activeHostID = Persistence.activeHostID().flatMap { id in hosts.first { $0.id == id }?.id } ?? hosts.first?.id
        lastViewed = Persistence.lastViewed()
        restoreSnapshot()
        pathMonitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in await self?.connection?.reconnectNow() }
        }
        pathMonitor.start(queue: .global(qos: .utility))
    }

    // MARK: Derived state

    var activeHost: PairedHost? { hosts.first { $0.id == activeHostID } }
    var isConnected: Bool { if case .ready = connectionState { true } else { false } }
    var canControl: Bool { isSample || (isConnected && (grantedScopes.contains("control") || grantedScopes.contains("write"))) }

    // MARK: Sample workspace

    /// A local, made-up workspace for trying the app without a computer.
    private(set) var isSample = false

    func startSample() {
        clearData()
        isSample = true
        projects = SampleData.projects
        threads = SampleData.threads
        latestRuns = Dictionary(uniqueKeysWithValues: SampleData.runs.map { ($0.sessionId, $0) })
        pendingApprovals = [SampleData.approval]
        lastSynced = .now
        // Show the brief as if you'd stepped away an hour ago.
        awaySince = Date.now.addingTimeInterval(-3600)
        briefDismissed = false
        publishWidget()
    }

    func endSample() {
        isSample = false
        clearData()
        restoreSnapshot()
    }

    private func loadSample(_ model: ThreadModel) {
        model.replaceMessages(MessagePage(messages: SampleData.messages(for: model.threadID), hasMore: false))
        let runs = SampleData.runs.filter { $0.sessionId == model.threadID }.map { latestRuns[$0.sessionId]?.id == $0.id ? latestRuns[$0.sessionId]! : $0 }
        model.apply(runs: runs)
        for run in runs { model.setEvents(SampleData.events(for: run.id), for: run.id) }
    }

    func project(_ id: String) -> Project? { projects.first { $0.id == id } }

    // MARK: Backdrop

    /// The conversation backdrop the computer's theme sets, per appearance.
    private(set) var backdrops = BackdropPair()

    /// Whether to draw it; Settings → Display → Backdrop.
    var showsBackdrop: Bool {
        get { UserDefaults.standard.object(forKey: "display.backdrop") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "display.backdrop"); backdropToggled.toggle() }
    }
    /// Observed stand-in for the defaults key above.
    private(set) var backdropToggled = false

    func backdrop(for scheme: ColorScheme) -> Backdrop? {
        _ = backdropToggled
        guard showsBackdrop else { return nil }
        return scheme == .dark ? backdrops.dark : backdrops.light
    }

    /// Reads `themes.backdrop` from the computer's config. Older computers don't
    /// have the channel; the last copy (or nothing) stays.
    func refreshBackdrop() async {
        guard let connection, isConnected, let hostID = activeHostID else { return }
        guard let slice = try? await connection.call("configGetEffective", as: ConfigSnapshotSlice.self) else { return }
        backdrops = slice.backdrops
        UserDefaults.standard.set(try? JSONEncoder().encode(backdrops), forKey: "backdrop.\(hostID.uuidString)")
    }

    func restoreBackdrop() {
        guard let hostID = activeHostID, let data = UserDefaults.standard.data(forKey: "backdrop.\(hostID.uuidString)"),
              let saved = try? JSONDecoder().decode(BackdropPair.self, from: data) else { backdrops = BackdropPair(); return }
        backdrops = saved
    }

    #if DEBUG
    func debugSetBackdrop(_ pair: BackdropPair) { backdrops = pair }
    #endif

    /// The agent's last reply in a run, from the open thread or the saved copy.
    func cachedReply(threadID: String, runID: String) -> String? {
        let live = threadModels[threadID]?.messages ?? []
        let messages = !live.isEmpty ? live : cachedMessages[threadID] ?? (isSample ? SampleData.messages(for: threadID) : [])
        return messages.last { $0.role == .assistant && ($0.runId == runID || $0.runId == nil) }?.content
    }
    func thread(_ id: String) -> ChatThread? { threads.first { $0.id == id } }

    func status(of thread: ChatThread) -> ThreadStatus {
        let run = latestRuns[thread.id]
        if pendingApprovals.contains(where: { approval in latestRuns[thread.id]?.id == approval.runId }) { return .needsApproval }
        // "Mark as unread" is kept on this device only.
        if lastViewed[thread.id] == Self.markedUnread, run?.status.isLive != true { return .unread }
        guard let run else { return .idle }
        switch run.status {
        case .approvalRequired: return .needsApproval
        case .queued, .running, .waiting: return .working
        case .failed, .blocked: return .failed
        case .cancelled: return .stopped
        case .completed:
            let finished = run.completedAt ?? run.updatedAt
            if let seen = lastViewed[thread.id], seen >= finished { return .idle }
            // Work that finished before this device was paired isn't news.
            if let paired = activeHost?.pairedAt, let date = Timestamp.date(finished), date < paired { return .idle }
            return .unread
        }
    }

    func approvals(for model: ThreadModel) -> [Approval] {
        pendingApprovals.filter { model.runs[$0.runId] != nil || latestRuns[model.threadID]?.id == $0.runId }
    }

    // MARK: Pairing

    func pair(with link: PairingLink) async throws {
        let (host, token) = try await Pairing.exchange(link, label: Pairing.deviceLabel)
        try Keychain.save(token, account: host.id.uuidString)
        // Pairing the same computer again replaces the old pairing. A pinned
        // computer is the same computer at any address; others match by address.
        for old in hosts where (host.fingerprint != nil && old.fingerprint == host.fingerprint)
            || (old.host == host.host && old.port == host.port) { forgetLocally(old) }
        hosts.append(host)
        Persistence.saveHosts(hosts)
        await activate(host.id)
        await notifier.requestAuthorizationIfNeeded()
    }

    func activate(_ id: UUID) async {
        guard hosts.contains(where: { $0.id == id }) else { return }
        await disconnect()
        if activeHostID != id {
            activeHostID = id
            Persistence.setActiveHostID(id)
            clearData()
            restoreSnapshot()
        }
        connect()
    }

    // MARK: Other computers

    /// Live connections to paired computers other than the active one, at most three.
    private(set) var watchers: [UUID: HostWatcher] = [:]

    func syncWatchers() {
        notifier.hostName = { [weak self] id in self?.hosts.first { $0.id == id }?.name }
        let wanted = isSample ? [] : hosts.filter { $0.id != activeHostID && !$0.isExpired }.prefix(3)
            .filter { Keychain.read(account: $0.id.uuidString) != nil }
        let wantedIDs = Set(wanted.map(\.id))
        for (id, watcher) in watchers where !wantedIDs.contains(id) {
            watchers[id] = nil
            Task { await watcher.stop() }
        }
        for host in wanted where watchers[host.id] == nil {
            guard let token = Keychain.read(account: host.id.uuidString) else { continue }
            let watcher = HostWatcher(host: host, token: token, notifier: notifier)
            watchers[host.id] = watcher
            watcher.start()
        }
    }

    func stopWatchers() async {
        let all = watchers.values
        watchers = [:]
        for watcher in all { await watcher.stop() }
    }

    /// Approvals waiting on the other computers, for the computer menu's badge.
    var otherHostsNeedYou: Int { watchers.values.reduce(0) { $0 + $1.needsYou } }

    /// Forgets the pairing on this device. The computer forgets it when it expires or is revoked there.
    func forget(_ host: PairedHost) async {
        if host.id == activeHostID { await disconnect() }
        forgetLocally(host)
        if activeHostID == host.id {
            activeHostID = hosts.first?.id
            Persistence.setActiveHostID(activeHostID)
            clearData()
            restoreSnapshot()
            if activeHostID != nil { connect() }
        }
    }

    private func forgetLocally(_ host: PairedHost) {
        Keychain.delete(account: host.id.uuidString)
        Persistence.deleteSnapshot(host.id)
        hosts.removeAll { $0.id == host.id }
        Persistence.saveHosts(hosts)
    }

    // MARK: Connection

    func connect() {
        syncWatchers()
        guard !isSample, connection == nil, let host = activeHost else { return }
        guard !host.isExpired, let token = Keychain.read(account: host.id.uuidString) else {
            connectionState = .unauthorized
            return
        }
        let connection = Connection(host: host, token: token)
        self.connection = connection
        listener = Task { [weak self] in
            for await signal in connection.signals {
                guard let self else { return }
                await self.handle(signal)
            }
        }
        Task { await connection.start() }
    }

    func disconnect() async {
        listener?.cancel()
        listener = nil
        await connection?.stop()
        connection = nil
        if connectionState != .unauthorized { connectionState = .idle }
        grantedScopes = []
    }

    func retryNow() async {
        if connection == nil { connect() } else { await connection?.reconnectNow() }
    }

    private func handle(_ signal: Signal) async {
        switch signal {
        case .renewed(let expires):
            updateActiveHost { $0.expiresAt = expires }
        case .unreachable:
            await rediscover()
        case .hello(let version, let protocolVersion):
            computerVersion = version
            computerProtocol = protocolVersion
        case .state(let state):
            connectionState = state
            if case .waiting(_, let reason) = state { lastConnectionProblem = reason }
            if case .ready(let scopes) = state {
                lastConnected = .now
                lastConnectionProblem = nil
                grantedScopes = scopes
                await refresh()
            }
        case .event(let event):
            apply(event)
        }
    }

    /// For the computer detail page.
    private(set) var lastConnected: Date?
    private(set) var lastConnectionProblem: String?

    func savedCopySize(of host: PairedHost) -> Int { Persistence.snapshotSize(host.id) }

    /// Drops the offline copy for a computer; the live data comes back on the next connection.
    func clearSavedCopy(of host: PairedHost) {
        Persistence.deleteSnapshot(host.id)
        if host.id == activeHostID { cachedMessages = [:] }
    }

    func providerUsage() async -> ProviderUsageSnapshot? {
        guard let connection, isConnected else { return nil }
        return try? await connection.call("providerUsage", as: ProviderUsageSnapshot.self)
    }

    /// The computer's Capsule version and protocol, from its last `ready`.
    private(set) var computerVersion: String?
    private(set) var computerProtocol = 0
    /// The protocol this app speaks; a computer below it may lack what the app needs.
    nonisolated static let protocolVersion = 1
    var computerNeedsUpdate: Bool { isConnected && computerProtocol < Self.protocolVersion }

    // MARK: Address

    @ObservationIgnored private var lastDiscovery: Date?
    private(set) var isDiscovering = false

    /// Looks for the computer on the local network when its address stops
    /// answering. Throttled: an unreachable computer is retried by backoff,
    /// not by browsing on every attempt.
    private func rediscover() async {
        guard let host = activeHost, let fingerprint = host.fingerprint, !isDiscovering else { return }
        if let last = lastDiscovery, Date.now.timeIntervalSince(last) < 30 { return }
        lastDiscovery = .now
        isDiscovering = true
        defer { isDiscovering = false }
        guard let found = await Discovery.find(fingerprint: fingerprint),
              found.host != host.host || found.port != host.port,
              activeHostID == host.id else { return }
        await moveActiveHost(to: found.host, port: found.port)
    }

    /// Changes where the active computer is reached, keeping its pairing.
    func moveActiveHost(to address: String, port: Int) async {
        updateActiveHost { $0.host = address; $0.port = port }
        if let host = activeHost { await connection?.relocate(to: host) }
    }

    func updateAddress(of id: UUID, host address: String, port: Int) async {
        if id == activeHostID {
            await moveActiveHost(to: address, port: port)
        } else if let index = hosts.firstIndex(where: { $0.id == id }) {
            hosts[index].host = address
            hosts[index].port = port
            Persistence.saveHosts(hosts)
        }
    }

    private func updateActiveHost(_ change: (inout PairedHost) -> Void) {
        guard let index = hosts.firstIndex(where: { $0.id == activeHostID }) else { return }
        var host = hosts[index]
        change(&host)
        guard host != hosts[index] else { return }
        hosts[index] = host
        Persistence.saveHosts(hosts)
    }

    private func apply(_ event: ServerEvent) {
        switch event {
        case .run(let run):
            let previous = latestRuns[run.sessionId]
            if previous == nil || previous!.createdAt <= run.createdAt { latestRuns[run.sessionId] = run }
            threadModels[run.sessionId]?.apply(run: run)
            if previous?.status.isLive == true, !run.status.isLive {
                notifier.runSettled(run, thread: thread(run.sessionId), visible: isVisible(run.sessionId))
                if isVisible(run.sessionId) { Self.announce(Self.settledPhrase(run.status), urgent: run.status != .completed) }
                // Watching it finish is reading it.
                if isVisible(run.sessionId) { markViewed(run.sessionId) }
            }
            touchThread(run.sessionId, at: run.updatedAt)
        case .runEvent(let event):
            if let sessionID = event.sessionId { threadModels[sessionID]?.apply(event: event) }
            else { threadModels.values.first { $0.runs[event.runId] != nil }?.apply(event: event) }
        case .message(let message):
            threadModels[message.sessionId]?.apply(message: message)
            var cached = cachedMessages[message.sessionId] ?? []
            cached.removeAll { $0.id == message.id }
            cached.append(message)
            cachedMessages[message.sessionId] = Array(cached.suffix(60))
            touchThread(message.sessionId, at: message.createdAt)
        case .approval(let approval):
            pendingApprovals.removeAll { $0.id == approval.id }
            if approval.status == .pending {
                pendingApprovals.append(approval)
                let sessionID = sessionID(forRun: approval.runId)
                notifier.approvalRequested(approval, thread: sessionID.flatMap(thread), visible: isVisible(sessionID))
                if isVisible(sessionID) {
                    Self.announce(String(localized: "Approval needed: \(approval.action)"), urgent: true)
                }
            }
        case .followUps(let sessionID, let value):
            threadModels[sessionID]?.apply(followUps: value)
            return
        case .state:
            Task { await refreshThreads() }
        }
        supervise(event)
        scheduleSave()
    }

    /// Tells VoiceOver what changed in the thread on screen.
    static func announce(_ text: String, urgent: Bool) {
        var message = AttributedString(text)
        message.accessibilitySpeechAnnouncementPriority = urgent ? .high : .default
        AccessibilityNotification.Announcement(message).post()
    }

    static func settledPhrase(_ status: RunStatus) -> String {
        switch status {
        case .completed: String(localized: "Turn finished")
        case .failed, .blocked: String(localized: "Turn failed")
        case .cancelled: String(localized: "Turn stopped")
        default: ""
        }
    }

    private func sessionID(forRun runID: String) -> String? {
        latestRuns.values.first { $0.id == runID }?.sessionId
            ?? threadModels.values.first { $0.runs[runID] != nil }?.threadID
    }

    private func touchThread(_ id: String, at time: String) {
        guard let index = threads.firstIndex(where: { $0.id == id }), threads[index].updatedAt < time else { return }
        threads[index].updatedAt = time
    }

    // MARK: Reading

    func refresh() async {
        if isSample { return }
        guard let connection, isConnected else { return }
        isSyncing = true
        defer { isSyncing = false }
        Task { await refreshBackdrop() }
        do {
            async let projects = connection.call("listProjects", as: [Project].self)
            async let threads = connection.call("listSessions", as: [ChatThread].self)
            async let runs = connection.call("listLatestRuns", as: [Run].self)
            async let approvals = connection.call("listApprovals", [.string("pending")], as: [Approval].self)
            let (p, t, r, a) = try await (projects, threads, runs, approvals)
            self.projects = p
            self.threads = t
            self.latestRuns = Dictionary(r.map { ($0.sessionId, $0) }, uniquingKeysWith: { $0.createdAt >= $1.createdAt ? $0 : $1 })
            self.pendingApprovals = a.filter { $0.status == .pending }
            lastSynced = .now
            syncError = nil
            for model in threadModels.values { Task { await load(model) } }
            scheduleSave()
        } catch {
            syncError = error.localizedDescription
        }
    }

    private func refreshThreads() async {
        guard let connection, isConnected else { return }
        do { threads = try await connection.call("listSessions", as: [ChatThread].self) } catch { syncError = error.localizedDescription }
    }

    func model(for threadID: String) -> ThreadModel {
        if let model = threadModels[threadID] { return model }
        let model = ThreadModel(threadID: threadID)
        if let cached = cachedMessages[threadID] { model.restore(cached: cached) }
        threadModels[threadID] = model
        return model
    }

    func load(_ model: ThreadModel) async {
        if isSample { loadSample(model); return }
        guard let connection, isConnected else { return }
        model.isLoading = true
        defer { model.isLoading = false }
        do {
            let limit = JSONValue.object(["limit": .number(60)])
            async let page = connection.call("listMessagePage", [.string(model.threadID), limit], as: MessagePage.self)
            async let runs = connection.call("listRuns", [.string(model.threadID)], as: [Run].self)
            async let queued = try? connection.call("getFollowUps", [.string(model.threadID)], as: FollowUps.self)
            let (p, r, q) = try await (page, runs, queued)
            if let q { model.apply(followUps: q) }
            model.replaceMessages(p)
            model.apply(runs: r)
            model.loadError = nil
            cachedMessages[model.threadID] = Array(p.messages.suffix(60))
            if let live = model.liveRun { await loadEvents(for: live.id, in: model) }
            scheduleSave()
        } catch {
            model.loadError = error.localizedDescription
        }
    }

    func loadOlder(_ model: ThreadModel) async {
        guard let connection, isConnected, model.hasOlder, !model.isLoadingOlder,
              let first = model.messages.first else { return }
        model.isLoadingOlder = true
        defer { model.isLoadingOlder = false }
        let options = JSONValue.object([
            "limit": .number(60),
            "before": .object(["createdAt": .string(first.createdAt), "id": .string(first.id)]),
        ])
        do {
            model.prependOlder(try await connection.call("listMessagePage", [.string(model.threadID), options], as: MessagePage.self))
            model.loadError = nil
        } catch {
            model.loadError = error.localizedDescription
        }
    }

    func loadEvents(for runID: String, in model: ThreadModel) async {
        guard let connection, isConnected else { return }
        do {
            model.setEvents(try await connection.call("listRunEventPage", [.string(runID)], as: RunEventPage.self).events, for: runID)
        } catch {
            model.logs[runID]?.fail(error.localizedDescription)
        }
    }

    /// The files a turn changed, without any patch text: quick even for a big change.
    func turnDiffSummary(runID: String) async throws -> TurnDiff {
        if isSample { return SampleData.diffSummary }
        guard let connection, isConnected else { throw RemoteError.notConnected }
        return try await connection.call("turnDiff", [.string(runID), .object(["summaryOnly": .bool(true)])], as: TurnDiff.self)
    }

    /// One file's patch from a turn.
    func turnDiff(runID: String, file: String) async throws -> TurnDiff {
        if isSample { return TurnDiff(patch: SampleData.patch(for: file), files: [], patchTruncated: false, filesTruncated: false, available: true) }
        guard let connection, isConnected else { throw RemoteError.notConnected }
        return try await connection.call("turnDiff", [.string(runID), .object(["relative": .string(file)])], as: TurnDiff.self, timeout: .seconds(45))
    }

    // MARK: Project inspection

    private func live() throws -> Connection {
        guard let connection, isConnected else { throw RemoteError.notConnected }
        return connection
    }

    /// Files whose names match, anywhere in the project (the computer searches).
    func searchFiles(projectID: String, query: String) async throws -> [FileEntry] {
        if isSample { return [] }
        return try await live().call("searchFiles", [.string(projectID), .string(query)], as: [FileEntry].self)
    }

    /// Text to drop into a thread's message box, from elsewhere in the app ("Ask about this file").
    var pendingInsert: (threadID: String, text: String)?

    func listFiles(projectID: String, folder: String?) async throws -> [FileEntry] {
        var args: [JSONValue] = [.string(projectID)]
        if let folder { args.append(.string(folder)) }
        return try await live().call("listFiles", args, as: [FileEntry].self)
    }

    func previewFile(projectID: String, path: String) async throws -> FilePreview {
        try await live().call("previewFile", [.string(projectID), .string(path)], as: FilePreview.self)
    }

    func gitStatus(projectID: String, threadID: String?) async throws -> GitStatus {
        try await live().call("gitStatus", [.string(projectID)] + (threadID.map { [.string($0)] } ?? []), as: GitStatus.self)
    }

    func gitDiff(projectID: String, path: String, threadID: String?) async throws -> String {
        try await live().call("gitDiff", [.string(projectID), .string(path)] + (threadID.map { [.string($0)] } ?? []), as: String.self, timeout: .seconds(45))
    }

    func pullRequests(projectID: String, threadID: String?) async throws -> PullRequestList {
        try await live().call("listPullRequests", [.string(projectID)] + (threadID.map { [.string($0)] } ?? []), as: PullRequestList.self, timeout: .seconds(45))
    }

    func pullRequest(projectID: String, number: Int, threadID: String?) async throws -> PullRequestDetail {
        try await live().call("getPullRequest", [.string(projectID), .number(Double(number))] + (threadID.map { [.string($0)] } ?? []),
                              as: PullRequestDetail.self, timeout: .seconds(45))
    }

    func agents() async throws -> [AgentInfo] {
        try await live().call("listAgents", as: [AgentInfo].self).filter { $0.kind != "system" }
    }

    @ObservationIgnored private var skillCache: [String: [SkillInfo]] = [:]

    @ObservationIgnored private var commandCache: [String: (list: [AgentCommandInfo], at: Date)] = [:]

    /// Installed skills for a thread's project, cached per project for the session.
    func skills(projectID: String, threadID: String?) async -> [SkillInfo] {
        if let cached = skillCache[projectID] { return cached }
        guard let connection, isConnected else { return [] }
        var args: [JSONValue] = [.string(projectID)]
        if let threadID { args.append(.string(threadID)) }
        let list = ((try? await connection.call("listSkills", args, as: [SkillInfo].self)) ?? [])
            .filter { $0.status == nil || $0.status == "installed" }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        skillCache[projectID] = list
        return list
    }

    /// Commands the thread's agent says it accepts ("/review", "/compact"…), as
    /// last reported to the computer. Sample threads have a few made-up ones.
    func agentCommands(threadID: String) async -> [AgentCommandInfo] {
        if isSample { return SampleData.commands }
        // Asking for status reaches the agent, so keep the answer a few minutes.
        if let cached = commandCache[threadID], cached.at.timeIntervalSinceNow > -300 { return cached.list }
        guard let connection, isConnected else { return [] }
        let status = try? await connection.call("harnessStatus", [.string(threadID)], as: HarnessStatusInfo.self)
        let list = (status?.parsed?.availableCommands ?? []).sorted { $0.name < $1.name }
        commandCache[threadID] = (list, .now)
        return list
    }

    /// A sent image, as the computer's preview of it.
    func messageImage(messageID: String, index: Int) async throws -> String? {
        guard let connection, isConnected else { throw RemoteError.notConnected }
        return try await connection.call("messageImage", [.string(messageID), .number(Double(index))], as: String?.self)
    }

    /// A message to scroll to when its thread next opens (from search).
    var pendingJump: (threadID: String, messageID: String)?

    /// Message contents across every thread, searched on the computer.
    func searchMessages(_ query: String) async throws -> [SearchResults.MessageHit] {
        if isSample {
            return SampleData.threads.flatMap { thread in
                SampleData.messages(for: thread.id).filter { $0.content.localizedStandardContains(query) }.map {
                    SearchResults.MessageHit(id: $0.id, sessionId: thread.id, projectId: thread.projectId, sessionTitle: thread.title,
                                             role: $0.role.rawValue, excerpt: String($0.content.prefix(160)))
                }
            }
        }
        guard let connection, isConnected else { throw RemoteError.notConnected }
        return try await connection.call("search", [.string(query)], as: SearchResults.self).messages
    }

    /// Loads older pages until a message is present (at most ten pages).
    func reveal(_ messageID: String, in model: ThreadModel) async -> Bool {
        for _ in 0..<10 {
            if model.messages.contains(where: { $0.id == messageID }) { return true }
            guard model.hasOlder else { return false }
            await loadOlder(model)
        }
        return model.messages.contains { $0.id == messageID }
    }

    /// `capsule://thread?id=…&fp=…`: opens this thread on any device paired with this computer.
    func threadLink(_ threadID: String) -> URL? {
        var components = URLComponents()
        components.scheme = "capsule"
        components.host = "thread"
        components.queryItems = [URLQueryItem(name: "id", value: threadID)]
            + (activeHost?.fingerprint.map { [URLQueryItem(name: "fp", value: String($0.prefix(16)))] } ?? [])
        return components.url
    }

    /// Opens a thread link: switches to the computer it belongs to, if paired.
    func open(threadLink url: URL) async -> String? {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard let id = items.first(where: { $0.name == "id" })?.value, !id.isEmpty else { return nil }
        if let prefix = items.first(where: { $0.name == "fp" })?.value,
           let host = hosts.first(where: { $0.fingerprint?.hasPrefix(prefix) == true }), host.id != activeHostID {
            await activate(host.id)
        }
        return id
    }

    nonisolated static let markedUnread = "unread"

    func markUnread(_ threadID: String) {
        lastViewed[threadID] = Self.markedUnread
        Persistence.setLastViewed(lastViewed)
    }

    // MARK: Thread actions (reversible; deleting stays on the computer)

    func rename(_ thread: ChatThread, to title: String) async throws {
        try await updateThread("renameSession", [.string(thread.id), .string(title)])
    }

    func setArchived(_ thread: ChatThread, _ archived: Bool) async throws {
        try await updateThread(archived ? "archiveSession" : "restoreSession", [.string(thread.id)])
    }

    func setPinned(_ thread: ChatThread, _ pinned: Bool) async throws {
        try await updateThread("pinSession", [.string(thread.id), .bool(pinned)])
    }

    private func updateThread(_ channel: String, _ args: [JSONValue]) async throws {
        if isSample, case .string(let id)? = args.first, let index = threads.firstIndex(where: { $0.id == id }) {
            switch (channel, args.dropFirst().first) {
            case ("renameSession", .string(let title)?): threads[index].title = title
            case ("archiveSession", _): threads[index].state = "archived"
            case ("restoreSession", _): threads[index].state = "active"
            case ("pinSession", .bool(let pinned)?): threads[index].pinned = pinned
            default: break
            }
            return
        }
        guard let connection, canControl else { throw RemoteError.notConnected }
        let data = try await connection.call(channel, args)
        if let updated = try? JSONDecoder().decode(ChatThread.self, from: data),
           let index = threads.firstIndex(where: { $0.id == updated.id }) {
            threads[index] = updated
        } else {
            await refreshThreads()
        }
        scheduleSave()
    }

    func markViewed(_ threadID: String) {
        let stamp = latestRuns[threadID].map { $0.completedAt ?? $0.updatedAt } ?? ISO8601DateFormatter().string(from: .now)
        guard lastViewed[threadID] != stamp else { return }
        lastViewed[threadID] = stamp
        Persistence.setLastViewed(lastViewed)
    }

    // MARK: Control

    private nonisolated struct SendResult: Decodable, Sendable { let run: Run; let userMessage: ChatMessage }

    /// Sends a photo or text file to the computer for this thread; attach the result to a message.
    func upload(_ data: Data, name: String, mimeType: String, threadID: String) async throws -> MessageAttachment {
        if isSample {
            return MessageAttachment(name: name, path: "sample/\(name)", size: Double(data.count), mimeType: mimeType, thumbnail: nil)
        }
        guard let connection, canControl else { throw RemoteError.notConnected }
        return try await connection.call("uploadAttachment", [.string(threadID), .string(name), .string(mimeType), .string(data.base64EncodedString())],
                                         as: MessageAttachment.self, timeout: .seconds(60))
    }

    func send(_ text: String, to model: ThreadModel, mode: ThreadMode? = nil, skillID: String? = nil,
              attachments: [MessageAttachment] = []) async throws {
        if isSample {
            let now = Date.now.formatted(.iso8601)
            model.apply(message: ChatMessage(id: UUID().uuidString, sessionId: model.threadID, role: .user, content: text,
                                             attachments: attachments.isEmpty ? nil : attachments, createdAt: now))
            try? await Task.sleep(for: .milliseconds(600))
            model.apply(message: ChatMessage(id: UUID().uuidString, sessionId: model.threadID, role: .assistant, content: SampleData.cannedReply,
                                             createdAt: Date.now.formatted(.iso8601)))
            return
        }
        guard let connection, canControl else { throw RemoteError.notConnected }
        var fields: [String: JSONValue] = ["sessionId": .string(model.threadID), "content": .string(text)]
        if let mode { fields["mode"] = .string(mode.rawValue) }
        if let skillID { fields["skillId"] = .string(skillID) }
        if !attachments.isEmpty {
            fields["attachments"] = .array(attachments.compactMap { $0.path.map { .object(["path": .string($0)]) } })
        }
        let input = JSONValue.object(fields)
        let result = try await connection.call("sendMessage", [input], as: SendResult.self)
        model.apply(message: result.userMessage)
        model.apply(run: result.run)
        latestRuns[model.threadID] = result.run
    }

    /// Queues a message behind the running turn. Sent once; never replayed.
    func queue(_ text: String, in model: ThreadModel, attachments: [MessageAttachment] = []) async throws {
        var prompt: [String: JSONValue] = ["content": .string(text)]
        if !attachments.isEmpty {
            prompt["attachments"] = .array(attachments.compactMap { file in
                file.path.map { .object(["path": .string($0), "name": .string(file.name), "size": .number(file.size ?? 0)]) }
            })
        }
        try await changeFollowUps(model, .object(["type": .string("add"), "prompt": .object(prompt)]))
    }

    func removeQueued(_ id: String, in model: ThreadModel) async throws {
        try await changeFollowUps(model, .object(["type": .string("remove"), "id": .string(id)]))
    }

    func moveQueued(_ id: String, up: Bool, in model: ThreadModel) async throws {
        try await changeFollowUps(model, .object(["type": .string("move"), "id": .string(id), "direction": .string(up ? "up" : "down")]))
    }

    private func changeFollowUps(_ model: ThreadModel, _ op: JSONValue) async throws {
        guard let connection, canControl else { throw RemoteError.notConnected }
        let result = try await connection.call("updateFollowUps", [.string(model.threadID), op], as: FollowUps.self)
        model.apply(followUps: result)
    }

    func stop(_ run: Run) async throws {
        guard let connection, canControl else { throw RemoteError.notConnected }
        let stopped = try await connection.call("stopRun", [.string(run.id)], as: Run.self)
        threadModels[run.sessionId]?.apply(run: stopped)
        latestRuns[run.sessionId] = stopped
    }

    /// Allow once, allow for the rest of this agent session, or deny.
    nonisolated enum Decision: String, Sendable {
        case once = "approved_once"
        case thread = "approved_session"
        case deny = "denied"
    }

    /// Whether this pairing may allow for a whole thread (pinned phones only).
    var canAllowForThread: Bool { canControl && activeHost?.fingerprint != nil }

    /// Uploads need the pinned phone channel (the desktop refuses them elsewhere).
    var canAttach: Bool { isSample || (canControl && activeHost?.fingerprint != nil) }

    func resolve(_ approval: Approval, _ decision: Decision) async throws {
        try await resolve(approvalID: approval.id, decision)
    }

    func resolve(approvalID: String, _ decision: Decision) async throws {
        if isSample {
            pendingApprovals.removeAll { $0.id == approvalID }
            if var run = latestRuns[SampleData.testsThread] {
                run.status = decision == .deny ? .cancelled : .completed
                run.completedAt = Date.now.formatted(.iso8601)
                run.updatedAt = run.completedAt!
                latestRuns[SampleData.testsThread] = run
                threadModels[SampleData.testsThread]?.apply(run: run)
                supervise(.run(run))
                threadModels[SampleData.testsThread]?.apply(message: ChatMessage(
                    id: UUID().uuidString, sessionId: SampleData.testsThread, role: .assistant,
                    content: decision == .deny ? SampleData.deniedReply : SampleData.approvedReply,
                    runId: run.id, createdAt: run.completedAt ?? Date.now.formatted(.iso8601)))
            }
            return
        }
        guard let connection, canControl else { throw RemoteError.notConnected }
        _ = try await connection.call("resolveApproval", [.string(approvalID), .string(decision.rawValue)])
        pendingApprovals.removeAll { $0.id == approvalID }
    }

    /// From a notification action: connect if needed, decide once, never retry.
    func resolveFromNotification(approvalID: String, _ decision: Decision, hostID: UUID? = nil) async -> Bool {
        if let hostID, hostID != activeHostID {
            syncWatchers()
            guard let watcher = watchers[hostID] else { return false }
            for _ in 0..<40 where !watcher.isConnected { try? await Task.sleep(for: .milliseconds(250)) }
            return await watcher.resolve(approvalID: approvalID, decision)
        }
        if !isSample {
            connect()
            for _ in 0..<40 where !isConnected {
                try? await Task.sleep(for: .milliseconds(250))
            }
        }
        do {
            try await resolve(approvalID: approvalID, decision)
            return true
        } catch {
            return false
        }
    }

    func createThread(in projectID: String, title: String?, agentID: String? = nil) async throws -> ChatThread {
        if isSample {
            let now = Date.now.formatted(.iso8601)
            let thread = ChatThread(id: UUID().uuidString, projectId: projectID, agentId: agentID ?? "claude",
                                    title: title?.isEmpty == false ? title! : String(localized: "New thread"),
                                    createdAt: now, updatedAt: now)
            threads.insert(thread, at: 0)
            return thread
        }
        guard let connection, canControl else { throw RemoteError.notConnected }
        var input: [String: JSONValue] = ["projectId": .string(projectID)]
        if let agentID { input["agentId"] = .string(agentID) }
        if let title, !title.isEmpty { input["title"] = .string(title) }
        let thread = try await connection.call("createSession", [.object(input)], as: ChatThread.self)
        threads.insert(thread, at: 0)
        return thread
    }

    // MARK: Offline copy

    private func clearData() {
        projects = []; threads = []; latestRuns = [:]; pendingApprovals = []
        threadModels = [:]; cachedMessages = [:]; lastSynced = nil; grantedScopes = []
    }

    private func restoreSnapshot() {
        restoreBackdrop()
        guard let id = activeHostID, let snapshot = Persistence.loadSnapshot(id) else { return }
        projects = snapshot.projects
        threads = snapshot.threads
        latestRuns = snapshot.latestRuns
        pendingApprovals = snapshot.pendingApprovals
        cachedMessages = snapshot.messages
        lastSynced = snapshot.savedAt
    }

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard let self, !Task.isCancelled, let id = self.activeHostID else { return }
            // Keep the most recently active threads' recent messages, not every thread ever opened.
            let recent = Set(self.threads.sorted { $0.updatedAt > $1.updatedAt }.prefix(30).map(\.id))
            let snapshot = Snapshot(projects: self.projects, threads: self.threads, latestRuns: self.latestRuns,
                                    pendingApprovals: self.pendingApprovals,
                                    messages: self.cachedMessages.filter { recent.contains($0.key) },
                                    savedAt: self.lastSynced ?? .now)
            await Task.detached { Persistence.saveSnapshot(snapshot, for: id) }.value
            self.publishWidget()
        }
    }
}

enum ThreadStatus: Equatable {
    case idle, working, needsApproval, failed, stopped, unread
}
