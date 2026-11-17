import SwiftUI

/*
 * What a turn changed, from the checkpoints the computer saved when it
 * finished. Files are grouped by folder, each opening into its own patch so a
 * big change never has to be laid out at once; from a patch, the up and down
 * arrows walk the list in the same order. "Viewed" marks are kept per turn.
 * The title menu switches to an earlier turn or to the uncommitted changes.
 */
struct DiffView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.dismiss) private var dismiss
    /// The thread's finished turns that saved a checkpoint, newest first.
    let turns: [Run]
    /// The thread to ask in, when lines can be asked about.
    var threadID: String? = nil
    /// Set when shown as an inspector column, which `dismiss` doesn't close.
    var close: (() -> Void)? = nil
    @State private var scope: ChangesScope
    @State private var diff: TurnDiff?
    @State private var path: [ChangesRoute] = []
    @State private var error: String?
    @State private var marks = ViewedMarks.load()
    @State private var query = ""
    @AppStorage("diff.hideViewed") private var hideViewed = false

    init(runID: String, turns: [Run] = [], threadID: String? = nil, close: (() -> Void)? = nil) {
        self.turns = turns
        self.threadID = threadID
        self.close = close
        _scope = State(initialValue: .turn(runID))
    }

    private var runID: String {
        if case .turn(let id) = scope { return id }
        return ""
    }

    private var askHandler: ((String) -> Void)? {
        guard let threadID, workspace.canControl else { return nil }
        return { text in
            workspace.pendingInsert = (threadID, text)
            if let close { close() } else { dismiss() }
        }
    }

    private var projectID: String? { threadID.flatMap { workspace.thread($0)?.projectId } }

    /// Every file in the order the list shows them, which is the order the arrows step through.
    private var ordered: [TurnDiff.File] { FolderGrouping(diff?.files ?? [], path: \.path).files }

    private var comments: Binding<[ReviewComment]> {
        Binding(get: { threadID.flatMap { workspace.reviewComments[$0] } ?? [] },
                set: { if let threadID { workspace.reviewComments[threadID] = $0.isEmpty ? nil : $0 } })
    }

    private var actions: ChangeActions {
        ChangeActions(runID: runID, ask: askHandler, canOpen: projectID != nil,
                      open: { path.append(.file($0)) }, marks: $marks, comments: comments)
    }

    var body: some View {
        NavigationStack(path: $path) {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.screen)
                .scrollContentBackground(.hidden)
                .navigationTitle("Changes")
                .navigationSubtitle(scopeTitle(scope))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { listToolbar }
                .toolbarTitleMenu { scopeMenu }
                .safeAreaInset(edge: .bottom, spacing: 0) { CommentsBar(actions: actions) }
                .navigationDestination(for: ChangesRoute.self) { route in
                    switch route {
                    case .patch(let start):
                        TurnFilePager(files: ordered, start: start, actions: actions)
                    case .file(let file):
                        if let projectID { FilePreviewView(projectID: projectID, path: file, threadID: threadID) }
                    }
                }
        }
        .task(id: scope) { await load() }
        .onChange(of: marks) { _, marks in marks.save() }
    }

    @ViewBuilder private var scopeMenu: some View {
        if turns.count > 1 || projectID != nil {
            Picker("Changes", selection: $scope) {
                Section("Turns") {
                    ForEach(turns) { run in
                        Text(turnTitle(run)).tag(ChangesScope.turn(run.id))
                    }
                }
                if projectID != nil {
                    Text("Uncommitted changes").tag(ChangesScope.workingTree)
                }
            }
        }
    }

    private func scopeTitle(_ scope: ChangesScope) -> String {
        switch scope {
        case .workingTree: return String(localized: "Uncommitted changes")
        case .turn(let id):
            guard let index = turns.firstIndex(where: { $0.id == id }) else { return String(localized: "This turn") }
            if index == 0 { return String(localized: "Latest turn") }
            return Timestamp.date(turns[index].createdAt).map { String(localized: "Turn from \(TurnLabel.stamp($0))") } ?? String(localized: "Earlier turn")
        }
    }

    /// "2:14 PM · Fix the login redirect", from the turn's prompt.
    private func turnTitle(_ run: Run) -> String {
        let prompt = (run.prompt ?? "").split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        let short = prompt.count > 44 ? String(prompt.prefix(43)) + "…" : prompt
        let stamp = Timestamp.date(run.createdAt).map { TurnLabel.stamp($0) } ?? ""
        return [stamp, short].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    @ToolbarContentBuilder private var listToolbar: some ToolbarContent {
        ToolbarItem(placement: .confirmationAction) {
            Button("Done") { if let close { close() } else { dismiss() } }.keyboardShortcut(.cancelAction)
        }
        if scope != .workingTree, let files = diff?.files, !files.isEmpty {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    Toggle("Hide viewed files", systemImage: "eye.slash", isOn: $hideViewed)
                    Divider()
                    Button("Mark all as viewed", systemImage: "checkmark.circle") { marks.set(true, files, in: runID) }
                        .disabled(marks.unviewedCount(files, in: runID) == 0)
                    Button("Mark all as unviewed", systemImage: "circle") { marks.set(false, files, in: runID) }
                        .disabled(marks.unviewedCount(files, in: runID) == files.count)
                } label: {
                    Label("Filter", systemImage: hideViewed ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                }
            }
        }
    }

    @ViewBuilder private var content: some View {
        if scope == .workingTree, let projectID {
            GitChangesView(projectID: projectID, threadID: threadID)
        } else if let error {
            ContentUnavailableView("Couldn't load changes", systemImage: "exclamationmark.triangle", description: Text(error))
        } else if let diff {
            if diff.available == false {
                ContentUnavailableView("Changes aren't available", systemImage: "clock.arrow.circlepath",
                                       description: Text("This turn's saved snapshots are missing on your computer."))
            } else if diff.files.isEmpty {
                ContentUnavailableView("No file changes", systemImage: "checkmark.circle", description: Text("This turn didn't change any files."))
            } else {
                ChangesList(diff: diff, actions: actions, query: query, hideViewed: $hideViewed)
                    .modifier(SearchWhenLong(count: diff.files.count, query: $query))
            }
        } else {
            ProgressView()
        }
    }

    private func load() async {
        guard case .turn(let runID) = scope else { return }
        diff = nil
        error = nil
        do {
            diff = try await workspace.turnDiffSummary(runID: runID)
            #if DEBUG
            if !DebugLaunch.diffFileShown, let file = UserDefaults.standard.string(forKey: "CapsuleDiffFile"),
               let match = diff?.files.first(where: { $0.path.hasSuffix(file) }) {
                DebugLaunch.diffFileShown = true
                path = [.patch(match.path)]
            }
            #endif
        } catch {
            self.error = error.localizedDescription
        }
    }
}

enum ChangesScope: Hashable {
    case turn(String)
    case workingTree
}

enum ChangesRoute: Hashable {
    case patch(String)
    case file(String)
}

/// What a file in a turn's changes can do, shared by the list and the patch.
struct ChangeActions {
    let runID: String
    let ask: ((String) -> Void)?
    let canOpen: Bool
    let open: (String) -> Void
    @Binding var marks: ViewedMarks
    @Binding var comments: [ReviewComment]

    /// Notes on one file's lines; only where lines can be asked about, since that's where they go.
    func notes(_ path: String) -> ReviewNotes? {
        guard ask != nil else { return nil }
        let binding = $comments
        return ReviewNotes(comments: comments.filter { $0.path == path },
                           add: { binding.wrappedValue.append($0) },
                           remove: { id in binding.wrappedValue.removeAll { $0.id == id } })
    }

    /// Sends every note to the message box as one block.
    func sendComments() {
        guard let ask, !comments.isEmpty else { return }
        ask(ReviewComment.block(comments))
        comments = []
        Haptics.success()
    }

    func isViewed(_ file: TurnDiff.File) -> Bool { marks.isViewed(file, in: runID) }
    func toggleViewed(_ file: TurnDiff.File) {
        marks.set(!isViewed(file), [file], in: runID)
        Haptics.selection()
    }
}

/// A search field once a turn changes enough files to look for one.
private struct SearchWhenLong: ViewModifier {
    let count: Int
    @Binding var query: String

    func body(content: Content) -> some View {
        if count > 8 {
            content.searchable(text: $query, placement: .navigationBarDrawer(displayMode: .automatic), prompt: Text("Filter files"))
        } else {
            content
        }
    }
}

private struct ChangesList: View {
    let diff: TurnDiff
    let actions: ChangeActions
    let query: String
    @Binding var hideViewed: Bool

    private var visible: [TurnDiff.File] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return diff.files.filter { file in
            (q.isEmpty || file.path.localizedCaseInsensitiveContains(q)) && !(hideViewed && actions.isViewed(file))
        }
    }

    var body: some View {
        let grouping = FolderGrouping(visible, path: \.path)
        // One folder needs no header: the summary already names it.
        let showFolders = grouping.groups.count > 1 || grouping.groups.first?.folder.isEmpty == false
        List {
            Section {
                EmptyView()
            } header: {
                ChangesSummary(diff: diff, actions: actions, common: FolderGrouping(diff.files, path: \.path).common)
            } footer: {
                if diff.filesTruncated == true || diff.patchTruncated == true {
                    Text("This change is large; some files are shown on your computer only.")
                }
            }
            ForEach(grouping.groups) { group in
                Section {
                    ForEach(group.files) { file in
                        ChangeListRow(file: file, actions: actions)
                    }
                } header: {
                    if showFolders { FolderHeader(folder: group.folder.isEmpty ? String(localized: "Top level") : group.folder) }
                }
            }
        }
        .listSectionSpacing(.compact)
        .overlay { emptyFilter(grouping.groups.isEmpty) }
    }

    @ViewBuilder private func emptyFilter(_ empty: Bool) -> some View {
        if empty && !query.trimmingCharacters(in: .whitespaces).isEmpty {
            ContentUnavailableView.search(text: query)
        } else if empty {
            ContentUnavailableView {
                Label("All files viewed", systemImage: "checkmark.circle")
            } actions: {
                Button("Show viewed files") { hideViewed = false }
            }
        }
    }
}

/// "12 files · 5 unviewed", the turn's line counts, and the folder they share.
private struct ChangesSummary: View {
    let diff: TurnDiff
    let actions: ChangeActions
    let common: String

    var body: some View {
        let added = diff.files.reduce(0) { $0 + ($1.added ?? 0) }
        let removed = diff.files.reduce(0) { $0 + ($1.removed ?? 0) }
        let unviewed = actions.marks.unviewedCount(diff.files, in: actions.runID)
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(countLine(unviewed))
                    .foregroundStyle(Color.textSecondary)
                Spacer(minLength: 8)
                LineCounts(added: added, removed: removed)
                ChangeBar(added: added, removed: removed)
            }
            .font(.footnote.weight(.medium).monospacedDigit())
            if !common.isEmpty {
                Text(common)
                    .font(.caption.monospaced())
                    .foregroundStyle(Color.textMuted)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .textCase(nil)
        .accessibilityElement(children: .combine)
    }

    private func countLine(_ unviewed: Int) -> String {
        let files = diff.files.count == 1 ? String(localized: "1 file") : String(localized: "\(diff.files.count) files")
        if unviewed == 0 { return String(localized: "\(files) · all viewed") }
        if unviewed == diff.files.count { return files }
        return String(localized: "\(files) · \(unviewed) unviewed")
    }
}

private struct ChangeListRow: View {
    let file: TurnDiff.File
    let actions: ChangeActions

    var body: some View {
        let viewed = actions.isViewed(file)
        NavigationLink(value: ChangesRoute.patch(file.path)) {
            ChangedFileRow(path: file.path, status: ChangeStatus(turn: file.status), added: file.added, removed: file.removed, viewed: viewed)
        }
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            Button { actions.toggleViewed(file) } label: {
                Label(viewed ? "Unviewed" : "Viewed", systemImage: viewed ? "circle" : "checkmark.circle")
            }
            .tint(viewed ? .gray : .success)
        }
        .contextMenu {
            ChangeFileMenu(file: file, actions: actions)
        }
    }
}

/// The file's own actions, in a row's context menu and the patch's toolbar.
struct ChangeFileMenu: View {
    let file: TurnDiff.File
    let actions: ChangeActions

    var body: some View {
        let viewed = actions.isViewed(file)
        Button(viewed ? "Mark as unviewed" : "Mark as viewed", systemImage: viewed ? "circle" : "checkmark.circle") {
            actions.toggleViewed(file)
        }
        if let ask = actions.ask {
            Button("Ask about this file", systemImage: "text.bubble") { ask("`\(file.path)` "); Haptics.success() }
        }
        if actions.canOpen && ChangeStatus(turn: file.status) != .deleted {
            Button("Open file", systemImage: "doc.text") { actions.open(file.path) }
        }
        Button("Copy path", systemImage: "doc.on.doc") { UIPasteboard.general.string = file.path; Haptics.tap() }
    }
}

/*
 * One file's patch, with the arrows to the previous and next file in the
 * list. Stays one screen while stepping, so Back returns to the list rather
 * than through every file seen.
 */
private struct TurnFilePager: View {
    @Environment(Workspace.self) private var workspace
    let files: [TurnDiff.File]
    let actions: ChangeActions
    @State private var current: String
    @AppStorage("diff.ignoreWhitespace") private var ignoreWhitespace = false

    init(files: [TurnDiff.File], start: String, actions: ChangeActions) {
        self.files = files
        self.actions = actions
        _current = State(initialValue: start)
    }

    private var index: Int? { files.firstIndex { $0.path == current } }
    private var file: TurnDiff.File { index.map { files[$0] } ?? TurnDiff.File(path: current) }

    var body: some View {
        TurnFilePatch(runID: actions.runID, path: current, ignoreWhitespace: ignoreWhitespace, ask: actions.ask, notes: actions.notes(current))
            .id(current + (ignoreWhitespace ? "\u{0}w" : ""))
            .safeAreaInset(edge: .top, spacing: 0) {
                FileHeaderBar(file: file, position: index.map { ($0 + 1, files.count) }, actions: actions)
            }
            .background(Color.screen)
            .navigationTitle((current as NSString).lastPathComponent)
            .navigationSubtitle((current as NSString).deletingLastPathComponent)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { pagerToolbar }
    }

    @ToolbarContentBuilder private var pagerToolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            Button { step(-1) } label: { Label("Previous file", systemImage: "chevron.up") }
                .disabled((index ?? 0) == 0)
                .keyboardShortcut(.upArrow, modifiers: [.command, .option])
            Button { step(1) } label: { Label("Next file", systemImage: "chevron.down") }
                .disabled(index.map { $0 >= files.count - 1 } ?? true)
                .keyboardShortcut(.downArrow, modifiers: [.command, .option])
        }
        ToolbarItemGroup(placement: .secondaryAction) {
            Toggle("Hide whitespace changes", systemImage: "space", isOn: $ignoreWhitespace)
            ChangeFileMenu(file: file, actions: actions)
            if !actions.comments.isEmpty {
                Button(actions.comments.count == 1 ? String(localized: "Add 1 comment to message") : String(localized: "Add \(actions.comments.count) comments to message"),
                       systemImage: "text.bubble") { actions.sendComments() }
            }
        }
    }

    private func step(_ delta: Int) {
        guard let index, files.indices.contains(index + delta) else { return }
        current = files[index + delta].path
        Haptics.selection()
    }
}

/// Under the title: how the file changed, where it sits in the list, and Viewed.
private struct FileHeaderBar: View {
    let file: TurnDiff.File
    let position: (Int, Int)?
    let actions: ChangeActions

    var body: some View {
        let status = ChangeStatus(turn: file.status)
        let viewed = actions.isViewed(file)
        HStack(spacing: 10) {
            Text(status.spoken.capitalized(with: .current))
                .foregroundStyle(status == .modified ? Color.textSecondary : StatusLetter.tint(status))
            LineCounts(added: file.added, removed: file.removed)
            Spacer(minLength: 8)
            if let position, position.1 > 1 {
                Text("\(position.0) of \(position.1)").foregroundStyle(Color.textMuted).monospacedDigit()
            }
            Button { actions.toggleViewed(file) } label: {
                Label("Viewed", systemImage: viewed ? "checkmark.square.fill" : "square")
                    .labelStyle(.titleAndIcon)
                    .foregroundStyle(viewed ? Color.textPrimary : Color.textSecondary)
            }
            .buttonStyle(.plain)
            .accessibilityValue(viewed ? Text("On") : Text("Off"))
        }
        .font(.footnote.weight(.medium))
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.bar)
        .overlay(alignment: .bottom) { Rectangle().fill(Color.hairline).frame(height: 0.5) }
    }
}

/// Loads one file's patch from the turn and shows it.
private struct TurnFilePatch: View {
    @Environment(Workspace.self) private var workspace
    let runID: String
    let path: String
    let ignoreWhitespace: Bool
    var ask: ((String) -> Void)? = nil
    var notes: ReviewNotes? = nil
    @State private var file: UnifiedDiff.FilePatch?
    @State private var truncated = false
    @State private var error: String?

    var body: some View {
        Group {
            if let error {
                ContentUnavailableView("Couldn't load this file", systemImage: "exclamationmark.triangle", description: Text(error))
            } else if let file {
                if file.isBinary {
                    ContentUnavailableView("Binary file", systemImage: "doc", description: Text("Binary changes can't be shown as text."))
                } else if file.lines.isEmpty {
                    ContentUnavailableView(ignoreWhitespace ? "Only whitespace changed" : "No line changes", systemImage: "doc.text",
                                           description: ignoreWhitespace ? Text("Turn off Hide whitespace changes to see them.") : Text("Only the file's mode or name changed."))
                } else {
                    PatchLines(file: file, truncated: truncated, ask: ask, notes: notes)
                }
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task { await load() }
    }

    private func load() async {
        do {
            let result = try await workspace.turnDiff(runID: runID, file: path, ignoreWhitespace: ignoreWhitespace)
            let parsed = await Task.detached { UnifiedDiff.parse(result.patch) }.value
            truncated = result.patchTruncated == true
            file = parsed.files.first ?? UnifiedDiff.FilePatch(path: path, lines: [], added: 0, removed: 0, isBinary: false)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Five blocks split between added and removed lines, so a file's shape reads at a glance.
struct ChangeBar: View {
    let added: Int
    let removed: Int

    /// Five blocks split by share; either side that changed at all gets at least one.
    static func blocks(added: Int, removed: Int) -> (green: Int, red: Int) {
        let total = added + removed
        guard total > 0 else { return (0, 0) }
        var green = Int((Double(added) / Double(total) * 5).rounded())
        if added > 0 { green = max(green, 1) }
        if removed > 0 { green = min(green, 4) }
        return (green, 5 - green)
    }

    var body: some View {
        let (green, red) = Self.blocks(added: added, removed: removed)
        HStack(spacing: 2) {
            ForEach(0..<5, id: \.self) { index in
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(index < green ? Color.success : index < green + red ? Color.failure : Color.subtleStrong)
                    .frame(width: 7, height: 7)
            }
        }
        .accessibilityHidden(true)
    }
}

#Preview("Word changes") {
    let patch = """
    diff --git a/Sources/Remote.ts b/Sources/Remote.ts
    --- a/Sources/Remote.ts
    +++ b/Sources/Remote.ts
    @@ -12,4 +12,4 @@ export const limits = {
       sessions: 64,
    -  timeoutMs: 3_000,
    +  timeoutMs: 10_000,
    -  maxPayload: 64 * 1024,
    +  maxPayload: transport === "phone" ? 4 * 1024 * 1024 : 64 * 1024,
     }
    """
    return NavigationStack {
        PatchLines(file: UnifiedDiff.parse(patch).files[0])
            .background(Color.screen)
    }
}

/// The notes waiting to go to the message box, under the list of changes.
private struct CommentsBar: View {
    let actions: ChangeActions

    var body: some View {
        if !actions.comments.isEmpty, actions.ask != nil {
            HStack(spacing: 10) {
                Menu {
                    Button("Discard comments", systemImage: "trash", role: .destructive) { actions.comments = [] }
                } label: {
                    Label(actions.comments.count == 1 ? String(localized: "1 comment") : String(localized: "\(actions.comments.count) comments"),
                          systemImage: "text.bubble")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.textSecondary)
                }
                Spacer(minLength: 8)
                Button("Add to message") { actions.sendComments() }
                    .buttonStyle(PrimaryButtonStyle())
                    .fixedSize()
            }
            .padding(.leading, 16)
            .padding(.trailing, 10)
            .padding(.vertical, 8)
            .glassSurface(cornerRadius: 26)
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
        }
    }
}
