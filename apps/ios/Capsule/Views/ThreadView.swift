import SwiftUI

struct ThreadView: View {
    @Environment(Workspace.self) private var workspace
    let threadID: String
    @State private var model: ThreadModel?

    var body: some View {
        Group {
            if let model {
                TranscriptView(model: model, threadID: threadID)
            } else {
                ProgressView()
            }
        }
        .task(id: threadID) {
            let model = workspace.model(for: threadID)
            self.model = model
            workspace.show(threadID)
            workspace.markViewed(threadID)
            await workspace.load(model)
        }
        .onChange(of: threadID) { old, _ in workspace.hide(old) }
        .onDisappear {
            workspace.hide(threadID)
        }
    }
}

/// What the transcript shows, in order.
enum TranscriptItem: Identifiable, Equatable {
    case loadOlder
    case day(String)
    case message(ChatMessage)
    /// A turn's work: live steps, or a settled turn's fold holding its interim messages.
    case work(runID: String, interim: [ChatMessage], answerAt: String?)
    case liveReply(runID: String)
    case runProblem(runID: String)
    /// A turn that only compacted the agent's context, shown as one divider.
    case compaction(runID: String)

    var id: String {
        switch self {
        case .loadOlder: "older"
        case .day(let key): "d-\(key)"
        case .message(let m): "m-\(m.id)"
        case .work(let id, _, _): "w-\(id)"
        case .liveReply(let id): "r-\(id)"
        case .runProblem(let id): "p-\(id)"
        case .compaction(let id): "c-\(id)"
        }
    }

    /// "/compact" and its alias ask the agent to summarise its own history.
    static func isCompaction(_ message: ChatMessage) -> Bool {
        guard message.role == .user else { return false }
        let text = message.content.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return ["/compact", "/context-compact"].contains { text == $0 || text.hasPrefix($0 + " ") || text.hasPrefix($0 + "\n") }
    }

    /// `streaming` is the runs with a reply in flight; their text is read by the
    /// reply's own view, so a streamed character never rebuilds this list.
    ///
    /// A settled turn reads prompt, fold, answer: the agent's earlier messages
    /// fold with its steps, and only its last message stays open.
    static func build(messages: [ChatMessage], runs: [String: Run], streaming: Set<String>, hasOlder: Bool) -> [TranscriptItem] {
        var items: [TranscriptItem] = hasOlder ? [.loadOlder] : []
        var answers: [String: ChatMessage] = [:]
        var interim: [String: [ChatMessage]] = [:]
        var compactions = Set<String>()
        for message in messages {
            guard let runID = message.runId, runs[runID] != nil else { continue }
            if isCompaction(message) { compactions.insert(runID) }
            if message.role == .assistant { answers[runID] = message }
        }
        for message in messages where message.role == .assistant {
            guard let runID = message.runId, let run = runs[runID], !run.status.isLive, answers[runID]?.id != message.id else { continue }
            interim[runID, default: []].append(message)
        }
        let folded = Set(interim.values.flatMap { $0.map(\.id) })

        var placed = Set<String>()
        var lastDay: String?
        func dayBreak(_ message: ChatMessage) {
            // A separator where the day changes, so "yesterday's" reply isn't mistaken for today's.
            if let day = message.createdAt.dayKey, day != lastDay {
                if lastDay != nil || messages.count > 1 { items.append(.day(day)) }
                lastDay = day
            }
        }
        func placeWork(_ runID: String) {
            guard placed.insert(runID).inserted, let run = runs[runID] else { return }
            items.append(.work(runID: runID, interim: interim[runID] ?? [], answerAt: answers[runID]?.createdAt))
            if run.status == .failed || run.status == .blocked, run.error != nil { items.append(.runProblem(runID: runID)) }
        }
        for message in messages {
            let runID = message.runId.flatMap { runs[$0] != nil ? $0 : nil }
            if let runID, compactions.contains(runID) {
                if placed.insert(runID).inserted { dayBreak(message); items.append(.compaction(runID: runID)) }
                continue
            }
            if folded.contains(message.id) {
                // Its prompt is on an earlier page: the fold still goes before the answer.
                if let runID { placeWork(runID) }
                continue
            }
            dayBreak(message)
            if message.role != .user, let runID { placeWork(runID) }
            items.append(.message(message))
            if message.role == .user, let runID { placeWork(runID) }
        }
        // A live turn's reply is shown once the user message is there to anchor it.
        for runID in streaming.sorted() where placed.contains(runID) && runs[runID]?.status.isLive == true {
            if !messages.contains(where: { $0.runId == runID && $0.role == .assistant }) {
                items.append(.liveReply(runID: runID))
            }
        }
        return items
    }

    /// The settled turn whose fold holds this message, if any.
    static func fold(holding messageID: String, in items: [TranscriptItem]) -> String? {
        for case .work(let runID, let interim, _) in items where interim.contains(where: { $0.id == messageID }) { return runID }
        return nil
    }
}

struct TranscriptView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSize
    @Environment(\.sidebarRoom) private var sidebarRoom
    @Environment(Workspace.self) private var workspace
    @Bindable var model: ThreadModel
    let threadID: String
    @State private var position = ScrollPosition(edge: .bottom)
    @State private var nearBottom = true
    @State private var settled = false
    @State private var highlight: String?
    @State private var diffRun: DiffRequest?
    @State private var showProject = false
    /// A file a reply named, opened from its code span.
    @State private var openedFile: OpenedFile?
    @State private var outsideFile: String?

    private var inspectorShown: Binding<Bool> {
        Binding(get: { diffRun != nil || showProject }, set: { if !$0 { closeInspector() } })
    }

    @ViewBuilder private var panel: some View {
        if let request = diffRun {
            DiffView(runID: request.runID, turns: reviewableRuns, threadID: threadID, close: closeInspector).id(request.runID)
        } else if showProject, let thread {
            ProjectInspector(projectID: thread.projectId,
                             projectName: workspace.project(thread.projectId)?.name ?? String(localized: "Project"),
                             threadID: thread.id, close: closeInspector)
        }
    }

    private func closeInspector() {
        diffRun = nil
        showProject = false
    }

    private var thread: ChatThread? { workspace.thread(threadID) }

    var body: some View {
        let items = TranscriptItem.build(messages: model.messages, runs: model.runs, streaming: Set(model.replies.keys), hasOlder: model.hasOlder)
        let approvals = workspace.approvals(for: model)
        ScrollView {
            // Not lazy: exact heights are what let the transcript open at, and
            // stay pinned to, the newest message. Pages come 60 messages at a
            // time, and settled turns fold, which keeps the row count down.
            VStack(alignment: .leading, spacing: 14) {
                ForEach(items) { item in
                    row(item, highlight: highlight)
                        .background(highlight == item.id ? Color.attention.opacity(0.12) : .clear,
                                    in: .rect(cornerRadius: 12))
                }
                ForEach(approvals) { approval in
                    let runIsLive = model.runs[approval.runId]?.status.isLive ?? true
                    if approval.isQuestion {
                        QuestionCard(approval: approval, runIsLive: runIsLive)
                    } else {
                        ApprovalCard(approval: approval, runIsLive: runIsLive)
                    }
                }
                if model.messages.isEmpty, !model.isLoading {
                    emptyThread
                }
            }
            .scrollTargetLayout()
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .scrollPosition($position)
        .task(id: model.isLoading) {
            // Opened from a search result: page back to the message and show it.
            guard !model.isLoading, let jump = workspace.pendingJump, jump.threadID == threadID else { return }
            workspace.pendingJump = nil
            guard await workspace.reveal(jump.messageID, in: model) else { return }
            settled = true
            nearBottom = false
            // A progress note the agent wrote mid-turn lives in that turn's fold: open it and go there.
            let target: String
            let current = TranscriptItem.build(messages: model.messages, runs: model.runs, streaming: [], hasOlder: model.hasOlder)
            if let runID = TranscriptItem.fold(holding: jump.messageID, in: current) {
                model.openFolds.insert(runID)
                target = "w-\(runID)"
            } else {
                target = "m-\(jump.messageID)"
            }
            withAnimation(.snappy) { position.scrollTo(id: target, anchor: target.hasPrefix("w-") ? .top : .center) }
            highlight = "m-\(jump.messageID)"
            try? await Task.sleep(for: .seconds(2))
            withAnimation(.easeOut(duration: 0.6)) { highlight = nil }
        }
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        .scrollDismissesKeyboard(.interactively)
        // Over the plain screen colour there is no edge: the cover under the bar hides what
        // scrolls up. Over a backdrop the system's soft edge stays; a hard one drew a second bar.
        .scrollEdgeEffectHidden(workspace.backdrop(for: colorScheme) == nil, for: .top)
        .onScrollGeometryChange(for: Bool.self) { geometry in
            // visibleRect accounts for the floating composer's inset.
            geometry.visibleRect.maxY >= geometry.contentSize.height + geometry.contentInsets.bottom - 60
        } action: { _, isNear in
            nearBottom = isNear
        }
        .onChange(of: items.last?.id) { _, _ in follow() }
        // The first full load lands at the newest message, not wherever a cached page left off.
        .onChange(of: model.isLoading) { wasLoading, loading in
            guard wasLoading, !loading, !settled else { return }
            settled = true
            // Twice: once now, once after the rows have measured their text.
            position.scrollTo(edge: .bottom)
            Task {
                try? await Task.sleep(for: .milliseconds(150))
                position.scrollTo(edge: .bottom)
            }
        }
        .onChange(of: approvals.count) { _, _ in follow() }
        .overlay(alignment: .bottom) {
            if !nearBottom {
                // Says what's down there: a decision waiting outranks new text.
                let waiting = approvals.first { model.runs[$0.runId]?.status.isLive ?? true }
                Button {
                    withAnimation(.snappy) { position.scrollTo(edge: .bottom) }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: waiting == nil ? "arrow.down" : waiting!.isQuestion ? "questionmark.bubble.fill" : "hand.raised.fill")
                            .foregroundStyle(waiting == nil ? Color.textPrimary : Color.attention)
                        Text(waiting == nil ? "Scroll to end" : waiting!.isQuestion ? "Question waiting" : "Approval waiting")
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.textPrimary)
                    .padding(.horizontal, 14)
                    .frame(height: 38)
                    .glassSurface(cornerRadius: 19)
                }
                .buttonStyle(.plain)
                .padding(16)
                .transition(.scale.combined(with: .opacity))
            }
        }
        .background {
            // Edge to edge, under the bars and the composer, like the plain background before it.
            if let backdrop = workspace.backdrop(for: colorScheme) { ConversationBackdrop(backdrop: backdrop) } else { Color.screen.ignoresSafeArea() }
        }
        .modifier(FileLinks(open: openFileLink, outside: $outsideFile))
        .sheet(item: $openedFile) { file in
            NavigationStack {
                FilePreviewView(projectID: file.projectID, path: file.ref.path, threadID: threadID, line: file.ref.line)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { openedFile = nil } } }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) { CoveredBanner(cover: workspace.backdrop(for: colorScheme) == nil) }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ComposerView(model: model)
        }
        .navigationTitle(thread?.title ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let project = thread.flatMap({ workspace.project($0.projectId) }) {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 1) {
                        Text(thread?.title ?? "")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.textPrimary)
                            .lineLimit(1)
                        HStack(spacing: 4) {
                            ProjectIcon(name: project.name, dataURL: project.iconDataUrl, size: 12)
                            Text(project.name).font(.caption).foregroundStyle(Color.textMuted).lineLimit(1)
                            if let harness = Harness(thread?.harnessId ?? thread?.agentId),
                               let name = AgentName.display(thread?.harnessId ?? thread?.agentId) {
                                HarnessMark(harness, size: 12).padding(.leading, 4)
                                Text(name).font(.caption).foregroundStyle(Color.textTertiary).lineLimit(1)
                            }
                        }
                    }
                    .frame(maxWidth: 240)
                    .accessibilityElement(children: .combine)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if let reviewable = latestReviewableRun {
                        Button("Latest turn's changes", systemImage: "plusminus") { showProject = false; diffRun = DiffRequest(runID: reviewable.id) }
                            .keyboardShortcut("d", modifiers: [.command, .shift])
                    }
                    Button("Project", systemImage: "folder") { diffRun = nil; showProject = true }
                        .keyboardShortcut("p", modifiers: [.command, .shift])
                    Divider()
                    Button("Copy link", systemImage: "link") {
                        UIPasteboard.general.url = workspace.threadLink(threadID)
                        Haptics.tap()
                    }
                    Button("Copy thread title", systemImage: "doc.on.doc") { UIPasteboard.general.string = thread?.title }
                } label: {
                    Label("Thread", systemImage: "ellipsis")
                }
            }
        }
        // A column beside the transcript on a wide iPad, a sheet on iPhone. The
        // inspector isn't attached at all on compact width: even hidden, it
        // takes over the app's navigation stack there.
        .modifier(SidePanel(regular: horizontalSize == .regular, isPresented: inspectorShown) { panel })
        .onChange(of: diffRun != nil || showProject) { _, open in
            if horizontalSize == .regular { sidebarRoom?(open) }
        }
        #if DEBUG
        // `-CapsuleSheet changes|project` opens that sheet once the thread loads.
        .task(id: model.isLoading) {
            // Launch arguments can't be removed from defaults, so remember it fired.
            guard !model.isLoading, !DebugLaunch.sheetShown, let sheet = UserDefaults.standard.string(forKey: "CapsuleSheet") else { return }
            DebugLaunch.sheetShown = true
            if sheet == "changes", let run = latestReviewableRun { diffRun = DiffRequest(runID: run.id) }
            if sheet == "project" { showProject = true }
        }
        #endif
        .modifier(ArrivalHaptics(approvals: approvals.count, liveRunID: model.liveRun?.id))
        .refreshable { await workspace.load(model) }
        .overlay {
            if model.messages.isEmpty, model.isLoading { ProgressView() }
        }
    }

    /// A tapped file name. An absolute path opens only inside the project's folder; the computer serves nothing else.
    private func openFileLink(_ url: URL) -> OpenURLAction.Result {
        guard let ref = FileRef(url: url) else { return .systemAction }
        guard let projectID = thread?.projectId else { return .discarded }
        let root = workspace.projects.first { $0.id == projectID }?.workingDirectory
        if let relative = FileRef.inProject(ref.path, root: root) {
            openedFile = OpenedFile(projectID: projectID, ref: FileRef(path: relative, line: ref.line, name: ref.name))
        } else {
            outsideFile = ref.path
        }
        return .handled
    }

    @ViewBuilder private func row(_ item: TranscriptItem, highlight: String?) -> some View {
        switch item {
        case .loadOlder:
            Button {
                Task { await workspace.loadOlder(model) }
            } label: {
                if model.isLoadingOlder { ProgressView().frame(maxWidth: .infinity) }
                else if model.loadError != nil { Label("Couldn't load earlier messages · Try again", systemImage: "arrow.clockwise").frame(maxWidth: .infinity) }
                else { Text("Show earlier messages").frame(maxWidth: .infinity) }
            }
            .buttonStyle(.borderless)
            .font(.subheadline)
            .foregroundStyle(Color.textMuted)
            .disabled(!workspace.isConnected)
        case .day(let key):
            DaySeparator(key: key)
        case .message(let message):
            MessageView(message: message, actions: message.role == .assistant)
        case .work(let runID, let interim, let answerAt):
            if let run = model.runs[runID], let log = model.logs[runID] {
                WorkLogView(run: run, log: log, model: model, interim: interim, answerAt: answerAt, highlight: highlight) {
                    showProject = false; diffRun = DiffRequest(runID: runID)
                }
            }
        case .compaction(let runID):
            CompactionDivider(run: model.runs[runID])
        case .liveReply(let runID):
            if let reply = model.replies[runID] {
                LiveReplyView(reply: reply, follow: follow)
            }
        case .runProblem(let runID):
            if let run = model.runs[runID], let error = run.error {
                RunProblem(run: run, error: error, model: model)
            }
        }
    }

    @ViewBuilder private var emptyThread: some View {
        // Nothing saved and no connection says nothing about the thread; don't call it empty.
        if workspace.isConnected {
            ContentUnavailableView("No messages yet", systemImage: "text.bubble",
                                   description: Text(workspace.canControl ? "Send the first message below." : "Messages sent from your computer appear here."))
                .padding(.top, 60)
        } else {
            ContentUnavailableView("Not loaded yet", systemImage: "arrow.trianglehead.2.clockwise",
                                   description: Text("This conversation loads when your computer is connected."))
                .padding(.top, 60)
        }
    }

    /// Finished turns with a saved checkpoint, newest first: the ones whose changes can be shown.
    private var reviewableRuns: [Run] {
        model.runs.values
            .filter { !$0.status.isLive && $0.checkpointRef != nil }
            .sorted { $0.createdAt > $1.createdAt }
    }

    private var latestReviewableRun: Run? { reviewableRuns.first }

    private func follow() {
        guard nearBottom else { return }
        withAnimation(.snappy) { position.scrollTo(edge: .bottom) }
    }
}

/// Opens tapped file names, and says so when one lies outside the project.
private struct FileLinks: ViewModifier {
    let open: (URL) -> OpenURLAction.Result
    @Binding var outside: String?

    func body(content: Content) -> some View {
        content
            .environment(\.openURL, OpenURLAction(handler: open))
            .alert("Outside this project", isPresented: Binding(get: { outside != nil }, set: { if !$0 { outside = nil } })) {
                Button("OK", role: .cancel) { outside = nil }
            } message: {
                Text("\(outside ?? "") is outside this conversation's project, so it can't be opened from your phone.")
            }
    }
}

struct OpenedFile: Identifiable {
    let projectID: String
    let ref: FileRef
    var id: String { "\(ref.path):\(ref.line ?? 0)" }
}

struct DiffRequest: Identifiable {
    let runID: String
    var id: String { runID }
}

struct TypingIndicator: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase = false

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .frame(width: 5, height: 5)
                    .opacity(reduceMotion ? 0.5 : (phase ? 1 : 0.25))
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.6).repeatForever().delay(Double(index) * 0.2), value: phase)
            }
        }
        .foregroundStyle(Color.textTertiary)
        .onAppear { phase = true }
        .accessibilityHidden(true)
    }
}

/// A reply as it streams. It alone observes the text, so each new chunk
/// re-renders this view and keeps the transcript following — nothing else.
private struct LiveReplyView: View {
    let reply: LiveReply
    let follow: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !reply.text.isEmpty {
                MarkdownView(text: reply.text).modifier(ReadingFont())
            }
            TypingIndicator()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("Agent is replying: \(reply.text)"))
        .onChange(of: reply.text) { follow() }
    }
}

/// Felt as well as seen: an approval arriving, a turn finishing.
private struct ArrivalHaptics: ViewModifier {
    let approvals: Int
    let liveRunID: String?

    func body(content: Content) -> some View {
        content
            .sensoryFeedback(.warning, trigger: approvals) { old, new in new > old }
            .sensoryFeedback(.success, trigger: liveRunID) { old, new in old != nil && new == nil }
    }
}

/// "Today", "Yesterday", or the date, centred between messages.
private struct DaySeparator: View {
    let key: String

    var body: some View {
        Text(label)
            .font(.caption.weight(.medium))
            .foregroundStyle(Color.textTertiary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 2)
            .accessibilityAddTraits(.isHeader)
    }

    private var label: String {
        guard let date = DateKey.date(key) else { return key }
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return String(localized: "Today") }
        if calendar.isDateInYesterday(date) { return String(localized: "Yesterday") }
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: .now)
        return sameYear ? date.formatted(.dateTime.weekday(.wide).day().month(.wide))
                        : date.formatted(.dateTime.day().month(.wide).year())
    }
}

#if DEBUG
enum DebugLaunch {
    static var sheetShown = false
    static var diffFileShown = false
}
#endif

/// An inspector column at regular width, a sheet otherwise.
private struct SidePanel<Panel: View>: ViewModifier {
    let regular: Bool
    @Binding var isPresented: Bool
    @ViewBuilder let panel: () -> Panel

    func body(content: Content) -> some View {
        if regular {
            content.inspector(isPresented: $isPresented) {
                panel().inspectorColumnWidth(min: 340, ideal: 420, max: 560)
            }
        } else {
            content.sheet(isPresented: $isPresented, content: panel)
        }
    }
}

/// Why a turn failed, with Retry on the thread's latest turn.
private struct RunProblem: View {
    @Environment(Workspace.self) private var workspace
    let run: Run
    let error: String
    let model: ThreadModel
    @State private var retrying = false
    @State private var retryError: String?

    /// Only the newest turn: retrying an old failure would answer a conversation that moved on.
    private var canRetry: Bool {
        workspace.mayControl && run.prompt?.isEmpty == false
            && model.runs.values.allSatisfy { $0.id == run.id || $0.createdAt <= run.createdAt }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            IconTile(symbol: "exclamationmark.triangle.fill", tint: .failure, background: .clear)
            VStack(alignment: .leading, spacing: 8) {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(Color.textPrimary)
                    .textSelection(.enabled)
                if let retryError {
                    Text(retryError).font(.footnote).foregroundStyle(Color.failure)
                }
                if canRetry {
                    Button {
                        Task { await retry() }
                    } label: {
                        HStack(spacing: 6) {
                            if retrying { ProgressView().controlSize(.mini) } else { Image(systemName: "arrow.clockwise") }
                            Text("Retry")
                        }
                        .font(.footnote.weight(.semibold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color.subtleStrong, in: .capsule)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.textPrimary)
                    .disabled(retrying || !workspace.canControl)
                    .accessibilityHint(Text("Sends the same message again."))
                }
            }
            .padding(.top, 3)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.failureBackground, in: .rect(cornerRadius: 14, style: .continuous))
    }

    private func retry() async {
        retrying = true
        defer { retrying = false }
        do {
            try await workspace.retry(run, in: model)
            retryError = nil
            Haptics.success()
        } catch {
            retryError = error.localizedDescription
            Haptics.warning()
        }
    }
}

/// Compacting is bookkeeping, not conversation: one line instead of a "/compact" bubble and its summary.
struct CompactionDivider: View {
    let run: Run?

    static func label(_ run: Run?) -> String {
        switch run?.status {
        case nil, .queued?, .running?, .waiting?, .approvalRequired?: String(localized: "Compacting context")
        case .failed?, .blocked?: String(localized: "Context compaction failed")
        case .cancelled?: String(localized: "Context compaction stopped")
        case .completed?: String(localized: "Context compacted")
        }
    }

    var body: some View {
        let failed = run?.status == .failed || run?.status == .blocked
        let reason = failed ? Notice.firstLine(run?.error) : nil
        HStack(spacing: 10) {
            Rectangle().fill(Color.hairline).frame(height: 1)
            Text(reason.map { "\(Self.label(run)): \($0)" } ?? Self.label(run))
                .font(.caption.weight(.medium))
                .foregroundStyle(failed ? Color.failure : Color.textTertiary)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .shimmering(run?.status.isLive ?? true)
                .layoutPriority(1)
            Rectangle().fill(Color.hairline).frame(height: 1)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}
