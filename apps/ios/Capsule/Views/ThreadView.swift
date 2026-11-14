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
    case work(runID: String)
    case liveReply(runID: String)
    case runProblem(runID: String)

    var id: String {
        switch self {
        case .loadOlder: "older"
        case .day(let key): "d-\(key)"
        case .message(let m): "m-\(m.id)"
        case .work(let id): "w-\(id)"
        case .liveReply(let id): "r-\(id)"
        case .runProblem(let id): "p-\(id)"
        }
    }

    /// `streaming` is the runs with a reply in flight; their text is read by the
    /// reply's own view, so a streamed character never rebuilds this list.
    static func build(messages: [ChatMessage], runs: [String: Run], streaming: Set<String>, hasOlder: Bool) -> [TranscriptItem] {
        var items: [TranscriptItem] = hasOlder ? [.loadOlder] : []
        var placed = Set<String>()
        var lastDay: String?
        for message in messages {
            // A separator where the day changes, so "yesterday's" reply isn't mistaken for today's.
            if let day = message.createdAt.dayKey, day != lastDay {
                if lastDay != nil || messages.count > 1 { items.append(.day(day)) }
                lastDay = day
            }
            items.append(.message(message))
            if message.role == .user, let runID = message.runId, runs[runID] != nil, !placed.contains(runID) {
                placed.insert(runID)
                items.append(.work(runID: runID))
                if let run = runs[runID], run.status == .failed || run.status == .blocked, run.error != nil {
                    items.append(.runProblem(runID: runID))
                }
            }
        }
        // A live turn's reply is shown once the user message is there to anchor it.
        for runID in streaming.sorted() where placed.contains(runID) && runs[runID]?.status.isLive == true {
            if !messages.contains(where: { $0.runId == runID && $0.role == .assistant }) {
                items.append(.liveReply(runID: runID))
            }
        }
        return items
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

    private var inspectorShown: Binding<Bool> {
        Binding(get: { diffRun != nil || showProject }, set: { if !$0 { closeInspector() } })
    }

    @ViewBuilder private var panel: some View {
        if let request = diffRun {
            DiffView(runID: request.runID, threadID: threadID, close: closeInspector).id(request.runID)
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
            // Not lazy: a page is at most 60 messages, and exact heights are what
            // let the transcript open at, and stay pinned to, the newest message.
            VStack(alignment: .leading, spacing: 14) {
                ForEach(items) { item in
                    row(item)
                        .background(highlight == item.id ? Color.attention.opacity(0.12) : .clear,
                                    in: .rect(cornerRadius: 12))
                }
                ForEach(approvals) { approval in
                    ApprovalCard(approval: approval, runIsLive: model.runs[approval.runId]?.status.isLive ?? true)
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
            withAnimation(.snappy) { position.scrollTo(id: "m-\(jump.messageID)", anchor: .center) }
            highlight = "m-\(jump.messageID)"
            try? await Task.sleep(for: .seconds(2))
            withAnimation(.easeOut(duration: 0.6)) { highlight = nil }
        }
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        .scrollDismissesKeyboard(.interactively)
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
            // Twice: once now, once after the lazy rows have measured themselves.
            position.scrollTo(edge: .bottom)
            Task {
                try? await Task.sleep(for: .milliseconds(150))
                position.scrollTo(edge: .bottom)
            }
        }
        .onChange(of: approvals.count) { _, _ in follow() }
        .overlay(alignment: .bottomTrailing) {
            if !nearBottom {
                Button {
                    withAnimation(.snappy) { position.scrollTo(edge: .bottom) }
                } label: {
                    Image(systemName: "arrow.down")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Color.textPrimary)
                        .frame(width: 38, height: 38)
                        .glassSurface(cornerRadius: 19)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Jump to latest"))
                .padding(16)
                .transition(.scale.combined(with: .opacity))
            }
        }
        .background {
            // Edge to edge, under the bars and the composer, like the plain background before it.
            if let backdrop = workspace.backdrop(for: colorScheme) { ConversationBackdrop(backdrop: backdrop) } else { Color.screen.ignoresSafeArea() }
        }
        .safeAreaInset(edge: .top, spacing: 0) { ConnectionBanner() }
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

    @ViewBuilder private func row(_ item: TranscriptItem) -> some View {
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
            MessageView(message: message)
        case .work(let runID):
            if let run = model.runs[runID], let log = model.logs[runID] {
                WorkLogView(run: run, log: log, model: model) { showProject = false; diffRun = DiffRequest(runID: runID) }
            }
        case .liveReply(let runID):
            if let reply = model.replies[runID] {
                LiveReplyView(reply: reply, follow: follow)
            }
        case .runProblem(let runID):
            if let error = model.runs[runID]?.error {
                HStack(alignment: .top, spacing: 10) {
                    IconTile(symbol: "exclamationmark.triangle.fill", tint: .failure, background: .clear)
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Color.textPrimary)
                        .textSelection(.enabled)
                        .padding(.top, 3)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.failureBackground, in: .rect(cornerRadius: 14, style: .continuous))
            }
        }
    }

    private var emptyThread: some View {
        ContentUnavailableView("No messages yet", systemImage: "text.bubble",
                               description: Text(workspace.canControl ? "Send the first message below." : "Messages sent from your computer appear here."))
            .padding(.top, 60)
    }

    private var latestReviewableRun: Run? {
        model.runs.values
            .filter { !$0.status.isLive && $0.checkpointRef != nil }
            .max { $0.createdAt < $1.createdAt }
    }

    private func follow() {
        guard nearBottom else { return }
        withAnimation(.snappy) { position.scrollTo(edge: .bottom) }
    }
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
