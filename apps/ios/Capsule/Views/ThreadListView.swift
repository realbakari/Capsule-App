import SwiftUI

/*
 * One flat list. Status decides the section — what needs you, what's
 * working, then everything else newest first — and the project rides on
 * each row, so a busy project never pushes a waiting approval off screen.
 */
struct ThreadListView: View {
    @Environment(Workspace.self) private var workspace
    @Binding var selection: String?
    @State private var query = ""
    @State private var showArchived = false
    @AppStorage("threads.groupByProject") private var groupByProject = false
    @State private var showSettings = false
    @State private var newThreadProject: Project?
    @State private var projectFilter: String?
    @State private var inspectProject: ChatThread?
    @State private var renaming: ChatThread?
    @State private var renameText = ""
    @State private var undo: UndoToast.Action?
    @State private var messageHits: [SearchResults.MessageHit] = []
    @State private var searchingMessages = false
    @State private var searchFocused = false
    @Environment(\.horizontalSizeClass) private var horizontalSize
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        List {
            if query.isEmpty, let brief = workspace.brief() {
                BriefCard(brief: brief, open: { id in selection = id }, dismiss: { withAnimation(.snappy) { workspace.dismissBrief() } })
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                    .listRowBackground(Color.screen)
                    .listRowSeparator(.hidden)
            }
            OtherComputersSection(open: { hostID, threadID in
                Task {
                    await workspace.activate(hostID)
                    selection = threadID
                }
            })
            ForEach(sections) { section in
                Section {
                    ForEach(section.threads) { thread in row(thread) }
                } header: {
                    SectionDivider(label: section.title)
                }
            }
            if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                Section {
                    ForEach(messageHits) { hit in
                        Button {
                            workspace.pendingJump = (hit.sessionId, hit.id)
                            selection = hit.sessionId
                        } label: {
                            MessageHitRow(title: hit.sessionTitle, excerpt: hit.excerpt, fromAgent: hit.role == "assistant", query: query)
                        }
                        .buttonStyle(RowButtonStyle())
                        .listRowInsets(EdgeInsets(top: 10, leading: 20, bottom: 10, trailing: 20))
                        .listRowBackground(Color.screen)
                    }
                } header: {
                    SectionDivider(label: "In messages")
                } footer: {
                    Group {
                        if !workspace.isConnected { Text("Searching messages needs your computer. Showing title matches only.") }
                        else if searchingMessages { ProgressView().frame(maxWidth: .infinity) }
                        else if messageHits.isEmpty { Text("No messages match.") }
                    }
                    .font(.caption)
                    .foregroundStyle(Color.textTertiary)
                    .padding(.horizontal, 20)
                }
            }
        }
        .task(id: query) {
            let trimmed = query.trimmingCharacters(in: .whitespaces)
            guard trimmed.count >= 2, workspace.isConnected else { messageHits = []; return }
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            searchingMessages = true
            defer { searchingMessages = false }
            messageHits = (try? await workspace.searchMessages(trimmed)) ?? []
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .contentMargins(.top, 0, for: .scrollContent)
        .background(Color.screen)
        .overlay { emptyState }
        .safeAreaInset(edge: .top, spacing: 0) { ConnectionBanner() }
        .animation(.snappy, value: workspace.connectionState)
        .searchable(text: $query, isPresented: $searchFocused, prompt: Text("Search threads and messages"))
        .background {
            // Keyboard shortcuts with no visible button: ⌘F to search, ⌘1–9 to open a thread.
            Group {
                Button("Search") { searchFocused = true }.keyboardShortcut("f", modifiers: .command)
                ForEach(Array(sections.flatMap(\.threads).prefix(9).enumerated()), id: \.element.id) { index, thread in
                    Button("Open \(thread.title)") { selection = thread.id }
                        .keyboardShortcut(KeyEquivalent(Character(String(index + 1))), modifiers: .command)
                }
            }
            .opacity(0)
            .accessibilityHidden(true)
        }
        .refreshable { await workspace.refresh() }
        .navigationTitle("Threads")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(removing: .title)
        .toolbar { toolbarContent }
        .modifier(MinimizeOnScroll())
        .sheet(isPresented: $showSettings) { SettingsView() }
        .overlay(alignment: .bottom) {
            UndoToast(action: $undo).padding(.bottom, 80)
        }
        .alert("Rename thread", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Title", text: $renameText)
            Button("Cancel", role: .cancel) { renaming = nil }
            Button("Rename") {
                guard let thread = renaming else { return }
                let old = thread.title
                let new = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
                renaming = nil
                guard !new.isEmpty, new != old else { return }
                act("Renamed") { try await workspace.rename(thread, to: new) } undo: { try await workspace.rename(thread, to: old) }
            }
        }
        .sheet(item: $inspectProject) { thread in
            ProjectInspector(projectID: thread.projectId,
                             projectName: workspace.project(thread.projectId)?.name ?? String(localized: "Project"),
                             threadID: thread.id)
        }
        .sheet(item: $newThreadProject) { project in
            NewThreadView(project: project) { thread in selection = thread.id }
        }
        .onChange(of: selection) { _, id in
            if let id { workspace.markViewed(id) }
        }
    }

    private func row(_ thread: ChatThread) -> some View {
        let project = workspace.project(thread.projectId)
        let status = workspace.status(of: thread)
        let selected = selection == thread.id && horizontalSize == .regular
        return Button {
            selection = thread.id
        } label: {
            ThreadRow(
                title: thread.title,
                project: project?.name,
                projectIcon: project?.iconDataUrl,
                agent: AgentName.display(thread.harnessId ?? thread.agentId),
                harness: Harness(thread.harnessId ?? thread.agentId),
                updatedAt: thread.updatedAt,
                pinned: thread.pinned == true,
                archived: thread.isArchived,
                status: status
            )
        }
        .buttonStyle(RowButtonStyle())
        .contextMenu {
            Button("Open", systemImage: "arrow.up.right") { selection = thread.id }
            if UIApplication.shared.supportsMultipleScenes {
                Button("Open in New Window", systemImage: "macwindow.badge.plus") { openWindow(id: "thread", value: thread.id) }
            }
            Button("Project", systemImage: "folder") { inspectProject = thread }
            Divider()
            readToggle(thread, status)
            if workspace.canControl {
                Button(thread.pinned == true ? "Unpin" : "Pin", systemImage: thread.pinned == true ? "pin.slash" : "pin") {
                    act(thread.pinned == true ? "Unpinned" : "Pinned") { try await workspace.setPinned(thread, thread.pinned != true) }
                        undo: { try await workspace.setPinned(thread, thread.pinned == true) }
                }
                Button("Rename", systemImage: "pencil") { renameText = thread.title; renaming = thread }
                Button(thread.isArchived ? "Restore" : "Archive", systemImage: thread.isArchived ? "tray.and.arrow.up" : "archivebox") {
                    act(thread.isArchived ? "Restored" : "Archived") { try await workspace.setArchived(thread, !thread.isArchived) }
                        undo: { try await workspace.setArchived(thread, thread.isArchived) }
                }
            }
        }
        .accessibilityAddTraits(selected ? .isSelected : [])
        .listRowInsets(EdgeInsets(top: 11, leading: 20, bottom: 11, trailing: 20))
        .listRowBackground(selected ? Color.subtleStrong : Color.screen)
        .listRowSeparatorTint(Color.hairline)
        .swipeActions(edge: .leading) {
            readToggle(thread, status).tint(Color.unreadDot)
            if workspace.canControl {
                Button(thread.pinned == true ? "Unpin" : "Pin", systemImage: thread.pinned == true ? "pin.slash" : "pin") {
                    act(thread.pinned == true ? "Unpinned" : "Pinned") { try await workspace.setPinned(thread, thread.pinned != true) }
                        undo: { try await workspace.setPinned(thread, thread.pinned == true) }
                }
                .tint(.orange)
            }
        }
        .swipeActions(edge: .trailing) {
            if workspace.canControl {
                Button(thread.isArchived ? "Restore" : "Archive", systemImage: thread.isArchived ? "tray.and.arrow.up" : "archivebox") {
                    act(thread.isArchived ? "Restored" : "Archived") { try await workspace.setArchived(thread, !thread.isArchived) }
                        undo: { try await workspace.setArchived(thread, thread.isArchived) }
                }
                .tint(.gray)
            }
        }
    }

    @ViewBuilder private func readToggle(_ thread: ChatThread, _ status: ThreadStatus) -> some View {
        if status == .unread {
            Button("Mark as read", systemImage: "envelope.open") { workspace.markViewed(thread.id) }
        } else {
            Button("Mark as unread", systemImage: "envelope.badge") { workspace.markUnread(thread.id) }
        }
    }

    /// Runs a reversible thread action and offers Undo for five seconds.
    private func act(_ done: LocalizedStringResource, _ action: @escaping () async throws -> Void,
                     undo reverse: @escaping () async throws -> Void) {
        Task {
            do {
                try await action()
                Haptics.success()
                undo = UndoToast.Action(label: done, reverse: reverse)
            } catch {
                workspace.syncError = error.localizedDescription
                Haptics.warning()
            }
        }
    }

    @ToolbarContentBuilder private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            HostMenu(showSettings: $showSettings)
        }
        .sharedBackgroundVisibility(.hidden)
        ToolbarItem(placement: .topBarTrailing) { moreMenu }
        DefaultToolbarItem(kind: .search, placement: .bottomBar)
        if workspace.canControl, !workspace.projects.isEmpty {
            ToolbarSpacer(.fixed, placement: .bottomBar)
            ToolbarItem(placement: .bottomBar) { newThreadMenu }
        }
    }

    private var moreMenu: some View {
        Menu {
            Menu {
                Picker("Project", selection: $projectFilter) {
                    Text("All projects").tag(String?.none)
                    ForEach(workspace.projects) { project in
                        Text(project.name).tag(Optional(project.id))
                    }
                }
            } label: {
                Label("Project", systemImage: "folder")
                Text(projectFilter.flatMap { workspace.project($0)?.name } ?? String(localized: "All projects"))
            }
            Toggle(isOn: $showArchived) { Label("Show archived", systemImage: "archivebox") }
            Toggle(isOn: $groupByProject) { Label("Group by project", systemImage: "rectangle.3.group") }
            Divider()
            Button("Refresh", systemImage: "arrow.clockwise") { Task { await workspace.refresh() } }
                .keyboardShortcut("r", modifiers: .command)
            Button("Settings", systemImage: "gearshape") { showSettings = true }
                .keyboardShortcut(",", modifiers: .command)
        } label: {
            Label("More", systemImage: projectFilter == nil && !showArchived ? "ellipsis" : "line.3.horizontal.decrease")
        }
    }

    private var newThreadMenu: some View {
        Menu {
            Section("New thread in") {
                ForEach(workspace.projects) { project in
                    Button(project.name) { newThreadProject = project }
                }
            }
            if let recent = recentProject {
                Divider()
                Button("New thread in \(recent.name)", systemImage: "square.and.pencil") { newThreadProject = recent }
                    .keyboardShortcut("n", modifiers: .command)
            }
        } label: {
            Label("New thread", systemImage: "square.and.pencil")
        }
    }

    // MARK: Data

    /// The project of the most recently active thread: where ⌘N starts.
    private var recentProject: Project? {
        workspace.threads.max { $0.updatedAt < $1.updatedAt }.flatMap { workspace.project($0.projectId) }
    }

    private struct ListSection: Identifiable {
        let id: String
        let title: LocalizedStringResource
        let threads: [ChatThread]
    }

    private var visible: [ChatThread] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        return workspace.threads.filter { thread in
            (showArchived || !thread.isArchived)
                && (projectFilter == nil || thread.projectId == projectFilter)
                && (trimmed.isEmpty || thread.title.localizedStandardContains(trimmed)
                    || (workspace.project(thread.projectId)?.name.localizedStandardContains(trimmed) ?? false))
        }
    }

    private var sections: [ListSection] {
        groupByProject ? projectSections : statusSections
    }

    /// One section per project, most recently active first; what needs you still leads.
    private var projectSections: [ListSection] {
        let sorted = visible.sorted { $0.updatedAt > $1.updatedAt }
        let attention = sorted.filter { [.needsApproval, .failed].contains(workspace.status(of: $0)) }
        let rest = sorted.filter { ![.needsApproval, .failed].contains(workspace.status(of: $0)) }
        var order: [String] = []
        var byProject: [String: [ChatThread]] = [:]
        for thread in rest {
            if byProject[thread.projectId] == nil { order.append(thread.projectId) }
            byProject[thread.projectId, default: []].append(thread)
        }
        let projects = order.map { id in
            ListSection(id: "project-\(id)", title: "\(workspace.project(id)?.name ?? String(localized: "Other"))",
                        threads: byProject[id] ?? [])
        }
        return ([ListSection(id: "attention", title: "Needs you", threads: attention)] + projects).filter { !$0.threads.isEmpty }
    }

    private var statusSections: [ListSection] {
        var attention: [ChatThread] = [], working: [ChatThread] = [], pinned: [ChatThread] = [], rest: [ChatThread] = []
        for thread in visible.sorted(by: { $0.updatedAt > $1.updatedAt }) {
            switch workspace.status(of: thread) {
            case .needsApproval, .failed: attention.append(thread)
            case .working: working.append(thread)
            default:
                if thread.pinned == true { pinned.append(thread) } else { rest.append(thread) }
            }
        }
        pinned.sort { ($0.pinOrder ?? 0) < ($1.pinOrder ?? 0) }
        return [
            ListSection(id: "attention", title: "Needs you", threads: attention),
            ListSection(id: "working", title: "Working", threads: working),
            ListSection(id: "pinned", title: "Pinned", threads: pinned),
            ListSection(id: "recent", title: "Recent", threads: rest),
        ].filter { !$0.threads.isEmpty }
    }

    @ViewBuilder private var emptyState: some View {
        if workspace.threads.isEmpty {
            if let error = workspace.syncError, workspace.isConnected {
                // Connected, but the computer couldn't answer: say so rather than "no threads".
                ContentUnavailableView {
                    Label("Your computer couldn't load threads", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("Try again") { Task { await workspace.refresh() } }
                        .buttonStyle(.bordered)
                }
            } else if workspace.isConnected && !workspace.isSyncing {
                ContentUnavailableView("No threads yet", systemImage: "bubble.left.and.bubble.right",
                                       description: Text("Start a conversation in Capsule on your computer and it appears here."))
            } else if !workspace.isConnected {
                ContentUnavailableView("Waiting for your computer", systemImage: "desktopcomputer",
                                       description: Text("Open Capsule on your computer and keep this device on the same network."))
            } else {
                ProgressView()
            }
        } else if visible.isEmpty {
            if query.isEmpty {
                ContentUnavailableView("Nothing here", systemImage: "line.3.horizontal.decrease",
                                       description: Text("No threads match this filter."))
            } else if messageHits.isEmpty && !searchingMessages {
                ContentUnavailableView.search(text: query)
            }
        }
    }
}

/// A section label with a hairline running to the trailing edge.
struct SectionDivider: View {
    let label: LocalizedStringResource
    @Environment(\.displayScale) private var scale

    var body: some View {
        HStack(spacing: 10) {
            Text(label)
                .font(.caption.weight(.medium))
                .foregroundStyle(Color.textTertiary)
                .textCase(nil)
            Rectangle().fill(Color.hairline).frame(height: 1 / scale)
        }
        .padding(.top, 6)
        .padding(.bottom, 2)
        .accessibilityAddTraits(.isHeader)
    }
}

struct ThreadRow: View {
    let title: String
    let project: String?
    let projectIcon: String?
    let agent: String?
    var harness: Harness? = nil
    let updatedAt: String
    let pinned: Bool
    let archived: Bool
    let status: ThreadStatus
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            // At accessibility sizes the meta line stacks instead of truncating.
            let meta = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2)) : AnyLayout(HStackLayout(spacing: 6))
            meta {
                ProjectIcon(name: project ?? "?", dataURL: projectIcon, size: 15)
                Text(project ?? String(localized: "No project"))
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Color.textMuted)
                    .lineLimit(1)
                    .layoutPriority(1)
                if let agent {
                    HStack(spacing: 4) {
                        if let harness { HarnessMark(harness, size: 13) } else { Text(verbatim: "·") }
                        Text(agent)
                    }
                    .font(.footnote)
                    .foregroundStyle(Color.textTertiary)
                    .lineLimit(1)
                    .padding(.leading, harness == nil ? 0 : 4)
                }
                if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
                if pinned {
                    Image(systemName: "pin.fill")
                        .font(.caption2)
                        .foregroundStyle(Color.textMuted)
                        .accessibilityLabel(Text("Pinned"))
                }
                trailing
            }
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                if status == .unread {
                    Circle().fill(Color.unreadDot).frame(width: 8, height: 8)
                        .accessibilityLabel(Text("New"))
                }
                Text(title.isEmpty ? String(localized: "Untitled thread") : title)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(Color.textPrimary)
                    .lineLimit(2)
                    .lineSpacing(1)
            }
            if archived {
                Label("Archived", systemImage: "archivebox")
                    .font(.caption)
                    .foregroundStyle(Color.textTertiary)
            }
        }
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var trailing: some View {
        if let label = status.label, status != .unread, status != .stopped {
            HStack(spacing: 4) {
                if status == .working { WorkingPulse() }
                Text(label)
            }
            .font(.caption.weight(.medium))
            .foregroundStyle(status.tint)
        } else {
            Text(updatedAt.relativeTime)
                .font(.caption.monospacedDigit())
                .foregroundStyle(Color.textTertiary)
        }
    }
}

/// A small dot that breathes while an agent is working; still under Reduce Motion.
struct WorkingPulse: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var on = false

    var body: some View {
        Circle()
            .frame(width: 6, height: 6)
            .opacity(reduceMotion ? 1 : (on ? 1 : 0.3))
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: on)
            .onAppear { on = true }
            .accessibilityHidden(true)
    }
}

/// Agent ids as people say them.
enum AgentName {
    static func display(_ id: String?) -> String? {
        guard let id, !id.isEmpty else { return nil }
        switch id.lowercased() {
        case "codex": return "Codex"
        case "claude", "claude-code", "claudecode": return "Claude Code"
        case "grok", "grok-build": return "Grok"
        case "gemini": return "Gemini"
        case "coding": return String(localized: "Coding agent")
        default: return id.prefix(1).uppercased() + id.dropFirst()
        }
    }
}

/*
 * Which computer this is and whether it's live, in one control: a dot for
 * the connection, the computer's name, and a menu to switch computers or
 * open settings.
 */
struct HostMenu: View {
    @Environment(Workspace.self) private var workspace
    @Binding var showSettings: Bool

    var body: some View {
        Menu {
            Section {
                ForEach(workspace.hosts) { host in
                    Button {
                        Task { await workspace.activate(host.id) }
                    } label: {
                        if host.id == workspace.activeHostID {
                            Label(host.name, systemImage: "checkmark")
                        } else {
                            Text(host.name)
                            if let watcher = workspace.watchers[host.id] { Text(Self.summary(watcher)) }
                        }
                    }
                }
            }
            if !workspace.isConnected {
                Button("Reconnect", systemImage: "arrow.clockwise") { Task { await workspace.retryNow() } }
            }
            Button("Settings", systemImage: "gearshape") { showSettings = true }
        } label: {
            // Which computer you're looking at, and whether it's reachable. The
            // app's own name adds nothing here; the computer's is what changes.
            VStack(alignment: .leading, spacing: 1) {
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text(title)
                        .font(.title3.weight(.semibold))
                        .tracking(-0.3)
                        .foregroundStyle(Color.textPrimary)
                        .lineLimit(1)
                    Image(systemName: "chevron.down")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.textMuted)
                        .overlay(alignment: .topTrailing) {
                            // Another computer is waiting on you.
                            if workspace.otherHostsNeedYou > 0 {
                                Circle().fill(Color.attention).frame(width: 7, height: 7).offset(x: 4, y: -2)
                            }
                        }
                }
                Text(statusLine)
                    .font(.footnote)
                    .foregroundStyle(statusColor)
                    .lineLimit(1)
            }
            .frame(maxWidth: 260, alignment: .leading)
            .contentShape(.rect)
        }
        .accessibilityLabel(Text("\(workspace.activeHost?.name ?? ""), \(stateText)"))
        .accessibilityValue(workspace.otherHostsNeedYou > 0 ? Text("Another computer needs you") : Text(""))
    }

    static func summary(_ watcher: HostWatcher) -> String {
        guard watcher.isConnected else { return String(localized: "Not connected") }
        if watcher.needsYou > 0 { return String(localized: "\(watcher.needsYou) need you") }
        if watcher.working > 0 { return String(localized: "\(watcher.working) working") }
        return String(localized: "Connected")
    }

    private var title: String {
        if workspace.isSample { return String(localized: "Sample workspace") }
        return workspace.activeHost?.name ?? String(localized: "Capsule")
    }

    /// Quiet when all is well; coloured only when something needs attention.
    private var statusColor: Color {
        if workspace.isSample { return .textMuted }
        return switch workspace.connectionState {
        case .waiting: .attention
        case .unauthorized: .failure
        default: .textMuted
        }
    }

    private var statusLine: String {
        if workspace.isSample { return String(localized: "No computer paired") }
        return switch workspace.connectionState {
        case .ready: String(localized: "Connected")
        case .connecting: String(localized: "Connecting…")
        case .waiting: String(localized: "Offline · retrying")
        case .unauthorized: String(localized: "Pairing ended")
        case .idle: String(localized: "Not connected")
        }
    }

    private var stateText: String {
        switch workspace.connectionState {
        case .ready: String(localized: "connected")
        case .connecting: String(localized: "connecting")
        case .waiting: String(localized: "offline")
        case .unauthorized: String(localized: "pairing ended")
        case .idle: String(localized: "not connected")
        }
    }
}

/// Lets the bars get out of the way while reading, where the system supports it.
struct MinimizeOnScroll: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 27, *) {
            content.toolbarMinimizationBehavior(.onScrollDown, for: .bottomBar)
        } else {
            content
        }
    }
}

/// A row that dims slightly while pressed, like a native cell, without a full-width flash.
struct RowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.55 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
            .contentShape(.hoverEffect, .rect(cornerRadius: 10))
            .hoverEffect(.highlight)
    }
}

/// "Archived · Undo" for five seconds after a thread action.
struct UndoToast: View {
    struct Action: Identifiable {
        let id = UUID()
        let label: LocalizedStringResource
        let reverse: () async throws -> Void
    }
    @Binding var action: Action?

    var body: some View {
        if let current = action {
            HStack(spacing: 14) {
                Text(current.label).font(.subheadline.weight(.medium)).foregroundStyle(Color.textPrimary)
                Button("Undo") {
                    let reverse = current.reverse
                    action = nil
                    Task { try? await reverse(); Haptics.tap() }
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.unreadDot)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .glassSurface(cornerRadius: 22)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .task(id: current.id) {
                try? await Task.sleep(for: .seconds(7))
                if action?.id == current.id { withAnimation(.snappy) { action = nil } }
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isStaticText)
            .onAppear { AccessibilityNotification.Announcement(String(localized: current.label)).post() }
        }
    }
}

/// A message that matched a search: its thread, and the excerpt with the match emphasised.
struct MessageHitRow: View {
    let title: String
    let excerpt: String
    let fromAgent: Bool
    let query: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Image(systemName: fromAgent ? "sparkle" : "person.fill")
                    .font(.caption2)
                    .foregroundStyle(Color.textTertiary)
                Text(title).font(.footnote.weight(.medium)).foregroundStyle(Color.textMuted).lineLimit(1)
            }
            Text(highlighted).font(.callout).foregroundStyle(Color.textPrimary).lineLimit(3)
        }
        .accessibilityElement(children: .combine)
    }

    private var highlighted: AttributedString {
        // Excerpts are raw Markdown; drop the markers so they read as text.
        let plain = excerpt.replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "**", with: "")
            .replacingOccurrences(of: "__", with: "")
            .replacingOccurrences(of: "`", with: "")
        var text = AttributedString(plain)
        let needle = query.trimmingCharacters(in: .whitespaces)
        if !needle.isEmpty, let range = text.range(of: needle, options: .caseInsensitive) {
            text[range].font = .callout.weight(.semibold)
            text[range].backgroundColor = Color.attention.opacity(0.18)
        }
        return text
    }
}

/*
 * Threads waiting on an approval on a paired computer you aren't looking at.
 * Opening one makes that computer the active one.
 */
private struct OtherComputersSection: View {
    @Environment(Workspace.self) private var workspace
    let open: (UUID, String) -> Void

    private var items: [(host: PairedHost, thread: ChatThread, approval: Approval)] {
        workspace.hosts.compactMap { host -> [(PairedHost, ChatThread, Approval)]? in
            guard let watcher = workspace.watchers[host.id] else { return nil }
            return watcher.pendingApprovals.compactMap { approval in
                guard let sessionID = watcher.latestRuns.values.first(where: { $0.id == approval.runId })?.sessionId,
                      let thread = watcher.thread(sessionID) else { return nil }
                return (host, thread, approval)
            }
        }.flatMap { $0 }
    }

    var body: some View {
        if !items.isEmpty {
            Section {
                ForEach(items, id: \.approval.id) { item in
                    Button { open(item.host.id, item.thread.id) } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Image(systemName: "hand.raised.fill").font(.footnote).foregroundStyle(Color.attention)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(item.host.name).font(.footnote.weight(.medium)).foregroundStyle(Color.textMuted)
                                Text(item.thread.title.isEmpty ? String(localized: "Untitled thread") : item.thread.title)
                                    .font(.body).foregroundStyle(Color.textPrimary).lineLimit(2)
                                Text(item.approval.action).font(.footnote).foregroundStyle(Color.textSecondary).lineLimit(1)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "arrow.left.arrow.right").font(.caption).foregroundStyle(Color.textTertiary)
                                .accessibilityHidden(true)
                        }
                        .contentShape(.rect)
                    }
                    .buttonStyle(RowButtonStyle())
                    .accessibilityHint(Text("Switches to \(item.host.name) and opens the thread."))
                    .listRowInsets(EdgeInsets(top: 11, leading: 20, bottom: 11, trailing: 20))
                    .listRowBackground(Color.screen)
                    .listRowSeparatorTint(Color.hairline)
                }
            } header: {
                SectionDivider(label: "On your other computers")
            }
        }
    }
}
