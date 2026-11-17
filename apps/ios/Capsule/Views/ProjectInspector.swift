import SwiftUI

/*
 * A project from the phone: what's changed in its working tree, its files,
 * and its pull requests. Everything here is reading — the computer refuses
 * file writes, commits and terminals from paired devices, so the inspector
 * never offers them.
 */
struct ProjectInspector: View {
    @Environment(\.dismiss) private var dismiss
    let projectID: String
    let projectName: String
    let threadID: String?
    /// Set when shown as an inspector column, which `dismiss` doesn't close.
    var close: (() -> Void)? = nil
    @State private var tab: Tab = .changes

    enum Tab: Hashable { case changes, files, pullRequests }

    var body: some View {
        NavigationStack {
            Group {
                switch tab {
                case .changes: GitChangesView(projectID: projectID, threadID: threadID)
                case .files: FilesRoot(projectID: projectID, threadID: threadID)
                case .pullRequests: PullRequestsView(projectID: projectID, threadID: threadID)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.screen)
            .navigationTitle(projectName)
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .top, spacing: 0) {
                Picker("Section", selection: $tab) {
                    Text("Changes").tag(Tab.changes)
                    Text("Files").tag(Tab.files)
                    Text("Pull requests").tag(Tab.pullRequests)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Color.screen)
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { if let close { close() } else { dismiss() } }.keyboardShortcut(.cancelAction) }
            }
        }
    }
}

/// Loads once, shows a spinner, an error with a retry, or the content.
struct Loadable<Value: Sendable, Content: View>: View {
    let load: () async throws -> Value
    @ViewBuilder let content: (Value) -> Content
    @State private var value: Value?
    @State private var error: String?

    var body: some View {
        Group {
            if let value {
                content(value)
            } else if let error {
                ContentUnavailableView {
                    Label("Couldn't load", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("Try again") { Task { await run() } }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task { await run() }
    }

    private func run() async {
        error = nil
        do { value = try await load() } catch { self.error = error.localizedDescription }
    }
}

// MARK: Changes

struct GitChangesView: View {
    @Environment(Workspace.self) private var workspace
    let projectID: String
    let threadID: String?

    var body: some View {
        Loadable(load: { try await workspace.gitStatus(projectID: projectID, threadID: threadID) }) { status in
            if !status.isRepo {
                ContentUnavailableView("Not a Git repository", systemImage: "point.3.connected.trianglepath.dotted",
                                       description: Text("This project's folder isn't tracked by Git."))
            } else {
                List {
                    Section {
                        HStack(spacing: 10) {
                            IconTile(symbol: "arrow.triangle.branch", tint: .textSecondary, size: 30)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(status.branch ?? String(localized: "Detached")).font(.body.weight(.medium).monospaced())
                                Text(syncLine(status)).font(.subheadline).foregroundStyle(Color.textMuted)
                            }
                            Spacer()
                            if status.changed > 0 {
                                ChangeBar(added: status.added ?? 0, removed: status.removed ?? 0)
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                    .listRowBackground(Color.card)
                    if status.files.isEmpty {
                        Section {
                            Label("Working tree clean", systemImage: "checkmark.circle")
                                .foregroundStyle(Color.textMuted)
                        }
                        .listRowBackground(Color.card)
                    } else {
                        let grouping = FolderGrouping(status.files, path: \.path)
                        ForEach(grouping.groups) { group in
                            Section {
                                ForEach(group.files) { change in
                                    NavigationLink {
                                        WorkingTreePatchView(projectID: projectID, threadID: threadID, path: change.path)
                                    } label: {
                                        ChangedFileRow(path: change.path, status: ChangeStatus(git: change.code), added: change.added, removed: change.removed)
                                    }
                                }
                            } header: {
                                VStack(alignment: .leading, spacing: 4) {
                                    if group.id == grouping.groups.first?.id {
                                        Text(status.files.count == 1 ? String(localized: "1 changed file") : String(localized: "\(status.files.count) changed files"))
                                        if !grouping.common.isEmpty {
                                            Text(grouping.common).font(.caption.monospaced()).foregroundStyle(Color.textMuted)
                                                .lineLimit(1).truncationMode(.middle).textCase(nil)
                                        }
                                    }
                                    if grouping.groups.count > 1 || !group.folder.isEmpty {
                                        FolderHeader(folder: group.folder.isEmpty ? String(localized: "Top level") : group.folder)
                                    }
                                }
                            }
                            .listRowBackground(Color.card)
                        }
                    }
                }
                .scrollContentBackground(.hidden)
            }
        }
    }

    private func syncLine(_ status: GitStatus) -> String {
        var parts: [String] = []
        if let ahead = status.ahead, ahead > 0 { parts.append(String(localized: "\(ahead) ahead")) }
        if let behind = status.behind, behind > 0 { parts.append(String(localized: "\(behind) behind")) }
        if parts.isEmpty { parts.append(status.dirty ? String(localized: "Uncommitted changes") : String(localized: "Up to date")) }
        return parts.joined(separator: " · ")
    }
}

struct WorkingTreePatchView: View {
    @Environment(Workspace.self) private var workspace
    let projectID: String
    let threadID: String?
    let path: String

    var body: some View {
        Loadable(load: {
            let patch = try await workspace.gitDiff(projectID: projectID, path: path, threadID: threadID)
            return await Task.detached { UnifiedDiff.parse(patch).files.first }.value
        }) { file in
            if let file, !file.lines.isEmpty {
                PatchLines(file: file)
            } else {
                ContentUnavailableView("No line changes", systemImage: "doc.text",
                                       description: Text("This file is new and untracked, binary, or only its mode changed."))
            }
        }
        .background(Color.screen)
        .navigationTitle((path as NSString).lastPathComponent)
        .navigationSubtitle((path as NSString).deletingLastPathComponent)
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: Files

/// The project's top folder, with a search across the whole tree.
struct FilesRoot: View {
    @Environment(Workspace.self) private var workspace
    let projectID: String
    let threadID: String?
    @State private var query = ""
    @State private var hits: [FileEntry] = []
    @State private var searching = false

    var body: some View {
        Group {
            if query.trimmingCharacters(in: .whitespaces).count >= 2 {
                if hits.isEmpty && !searching {
                    ContentUnavailableView.search(text: query)
                } else {
                    List(hits) { entry in
                        NavigationLink {
                            FilePreviewView(projectID: projectID, path: entry.path, threadID: threadID)
                        } label: {
                            HStack(spacing: 12) {
                                FileGlyph(path: entry.name, size: 28)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(entry.name).font(.body)
                                    let folder = (entry.path as NSString).deletingLastPathComponent
                                    if !folder.isEmpty { Text(folder).font(.subheadline).foregroundStyle(Color.textMuted).lineLimit(1).truncationMode(.head) }
                                }
                            }
                        }
                        .listRowBackground(Color.card)
                    }
                    .scrollContentBackground(.hidden)
                    .overlay { if searching && hits.isEmpty { ProgressView() } }
                }
            } else {
                FolderView(projectID: projectID, folder: nil, threadID: threadID)
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: Text("Find a file"))
        .task(id: query) {
            let trimmed = query.trimmingCharacters(in: .whitespaces)
            guard trimmed.count >= 2 else { hits = []; return }
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            searching = true
            defer { searching = false }
            hits = Array(((try? await workspace.searchFiles(projectID: projectID, query: trimmed)) ?? []).filter { !$0.isDirectory }.prefix(200))
        }
    }
}

struct FolderView: View {
    @Environment(Workspace.self) private var workspace
    let projectID: String
    let folder: String?
    var threadID: String? = nil

    var body: some View {
        Loadable(load: { try await workspace.listFiles(projectID: projectID, folder: folder) }) { entries in
            let sorted = entries.sorted { ($0.isDirectory ? 0 : 1, $0.name.lowercased()) < ($1.isDirectory ? 0 : 1, $1.name.lowercased()) }
            if sorted.isEmpty {
                ContentUnavailableView("Empty folder", systemImage: "folder")
            } else {
                List(sorted) { entry in
                    NavigationLink {
                        if entry.isDirectory {
                            FolderView(projectID: projectID, folder: entry.path, threadID: threadID)
                        } else {
                            FilePreviewView(projectID: projectID, path: entry.path, threadID: threadID)
                        }
                    } label: {
                        HStack(spacing: 12) {
                            if entry.isDirectory {
                                IconTile(symbol: "folder.fill", tint: .textSecondary, size: 28)
                            } else {
                                FileGlyph(path: entry.name, size: 28)
                            }
                            Text(entry.name).font(.body)
                        }
                    }
                    .listRowBackground(Color.card)
                }
                .scrollContentBackground(.hidden)
            }
        }
        .modifier(FolderTitle(folder: folder))
    }
}

struct FilePreviewView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.dismiss) private var dismiss
    let projectID: String
    let path: String
    var threadID: String? = nil
    /// The line a reply pointed at; the code view opens there.
    var line: Int? = nil
    @State private var rendered = true

    private var isMarkdown: Bool { ["md", "mdx", "markdown"].contains((path as NSString).pathExtension.lowercased()) }

    var body: some View {
        Loadable(load: { try await workspace.previewFile(projectID: projectID, path: path) }) { preview in
            switch preview.kind {
            case "image":
                if let image = ProjectIconCache.image(for: preview.dataUrl) {
                    ScrollView([.horizontal, .vertical]) {
                        Image(uiImage: image).resizable().scaledToFit().padding()
                    }
                } else {
                    ContentUnavailableView("Can't show this image", systemImage: "photo")
                }
            case "text":
                if isMarkdown && rendered && line == nil {
                    ScrollView {
                        MarkdownView(text: preview.contents ?? "")
                            .modifier(ReadingFont())
                            .padding(16)
                            .frame(maxWidth: 760, alignment: .leading)
                            .frame(maxWidth: .infinity)
                    }
                } else {
                    CodeFileView(text: preview.contents ?? "", truncated: preview.truncated, path: path, target: line)
                }
            default:
                ContentUnavailableView("Binary file", systemImage: "doc",
                                       description: Text(preview.detail ?? String(localized: "Open it on your computer.")))
            }
        }
        .background(Color.screen)
        .navigationTitle((path as NSString).lastPathComponent)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if isMarkdown {
                        Button(rendered ? "Show source" : "Show formatted", systemImage: rendered ? "chevron.left.forwardslash.chevron.right" : "doc.richtext") { rendered.toggle() }
                    }
                    if let threadID, workspace.canControl {
                        Button("Ask about this file", systemImage: "text.bubble") {
                            workspace.pendingInsert = (threadID, "`\(path)` ")
                            Haptics.success()
                        }
                    }
                    Button("Copy path", systemImage: "link") { UIPasteboard.general.string = path; Haptics.tap() }
                } label: {
                    Label("File", systemImage: "ellipsis")
                }
            }
        }
    }
}

/// A source file with line numbers; long lines scroll rather than wrap.
private struct CodeFileView: View {
    let text: String
    let truncated: Bool
    var path = ""
    /// One-based; highlighted and scrolled to.
    var target: Int? = nil
    @State private var viewport: CGFloat = 0

    var body: some View {
        let lines = text.components(separatedBy: "\n")
        ScrollViewReader { reader in
            ScrollView([.vertical, .horizontal]) {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                    HStack(alignment: .top, spacing: 0) {
                        Text("\(index + 1)")
                            .frame(minWidth: 40, alignment: .trailing)
                            .foregroundStyle(Color.textTertiary)
                            .padding(.trailing, 12)
                            .accessibilityHidden(true)
                        Text(line.isEmpty ? AttributedString(" ") : Highlighted.code(line, language: SyntaxHighlighter.language(forPath: path), key: path))
                            .monospaced()
                            .foregroundStyle(Color.textPrimary)
                            .fixedSize(horizontal: true, vertical: false)
                    }
                    .font(.footnote.monospaced())
                    .padding(.vertical, 1)
                    .background(target == index + 1 ? Color.attention.opacity(0.14) : Color.clear)
                    .id(index + 1)
                }
                if truncated {
                    Text("The rest of this file is on your computer.")
                        .font(.footnote)
                        .foregroundStyle(Color.textMuted)
                        .padding(.top, 12)
                }
            }
            .padding(12)
            .frame(minWidth: viewport, alignment: .leading)
            .textSelection(.enabled)
        }
        .defaultScrollAnchor(.topLeading)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { viewport = $0 }
        .task {
            // Only a line the preview holds: a truncated file may stop before it.
            guard let target, target <= lines.count else { return }
            try? await Task.sleep(for: .milliseconds(100))
            reader.scrollTo(target, anchor: UnitPoint(x: 0, y: 0.3))
        }
        }
    }
}

// MARK: Pull requests

struct PullRequestsView: View {
    @Environment(Workspace.self) private var workspace
    let projectID: String
    let threadID: String?

    var body: some View {
        Loadable(load: { try await workspace.pullRequests(projectID: projectID, threadID: threadID) }) { list in
            if let error = list.error {
                ContentUnavailableView("Pull requests unavailable", systemImage: "arrow.triangle.pull", description: Text(error))
            } else if (list.items ?? []).isEmpty {
                ContentUnavailableView("No open pull requests", systemImage: "arrow.triangle.pull")
            } else {
                List(list.items ?? []) { pr in
                    NavigationLink {
                        PullRequestDetailView(projectID: projectID, threadID: threadID, number: pr.number)
                    } label: {
                        PullRequestRow(pr: pr)
                    }
                    .listRowBackground(Color.card)
                }
                .scrollContentBackground(.hidden)
            }
        }
    }
}

private struct PullRequestRow: View {
    let pr: GitPullRequest

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconTile(symbol: pr.isDraft ? "circle.dashed" : "arrow.triangle.pull",
                     tint: pr.isDraft ? .textMuted : .success, size: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(pr.title).font(.body).foregroundStyle(Color.textPrimary).lineLimit(2)
                HStack(spacing: 6) {
                    Text(verbatim: "#\(pr.number)").font(.subheadline.monospacedDigit())
                    if let author = pr.author { Text(author).font(.subheadline) }
                    if let branch = pr.headRefName { Text(branch).font(.subheadline.monospaced()).lineLimit(1) }
                }
                .foregroundStyle(Color.textMuted)
            }
            Spacer(minLength: 4)
            if let checks = pr.checks, checks != "none" {
                Image(systemName: checks == "success" ? "checkmark.circle.fill" : checks == "failure" ? "xmark.circle.fill" : "clock")
                    .foregroundStyle(checks == "success" ? Color.success : checks == "failure" ? Color.failure : Color.attention)
                    .accessibilityLabel(Text(pr.checksSummary ?? checks))
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Subfolders take their own name as the title; the root keeps the project's.
private struct FolderTitle: ViewModifier {
    let folder: String?
    func body(content: Content) -> some View {
        if let folder {
            content.navigationTitle((folder as NSString).lastPathComponent)
        } else {
            content
        }
    }
}
