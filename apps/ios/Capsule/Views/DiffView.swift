import SwiftUI

/*
 * What a turn changed, from the checkpoints the computer saved when it
 * finished. Files first, with counts; each opens into its own patch so a big
 * change never has to be laid out at once.
 */
struct DiffView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.dismiss) private var dismiss
    let runID: String
    /// The thread to ask in, when lines can be asked about.
    var threadID: String? = nil
    /// Set when shown as an inspector column, which `dismiss` doesn't close.
    var close: (() -> Void)? = nil
    @State private var diff: TurnDiff?
    @State private var path: [String] = []
    @State private var error: String?

    private var askHandler: ((String) -> Void)? {
        guard let threadID, workspace.canControl else { return nil }
        return { text in
            workspace.pendingInsert = (threadID, text)
            if let close { close() } else { dismiss() }
        }
    }

    var body: some View {
        NavigationStack(path: $path) {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.screen)
                .scrollContentBackground(.hidden)
                .navigationTitle("Changes")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { if let close { close() } else { dismiss() } }.keyboardShortcut(.cancelAction) }
                }
                .navigationDestination(for: String.self) { path in
                    FilePatchView(runID: runID, path: path, ask: askHandler)
                }
        }
        .task { await load() }
    }

    @ViewBuilder private var content: some View {
        if let error {
            ContentUnavailableView("Couldn't load changes", systemImage: "exclamationmark.triangle", description: Text(error))
        } else if let diff {
            if diff.available == false {
                ContentUnavailableView("Changes aren't available", systemImage: "clock.arrow.circlepath",
                                       description: Text("This turn's saved snapshots are missing on your computer."))
            } else if diff.files.isEmpty {
                ContentUnavailableView("No file changes", systemImage: "checkmark.circle", description: Text("This turn didn't change any files."))
            } else {
                List {
                    Section {
                        ForEach(diff.files) { file in
                            NavigationLink(value: file.path) {
                                FileSummaryRow(file: file)
                            }
                        }
                    } header: {
                        let added = diff.files.reduce(0) { $0 + ($1.added ?? 0) }
                        let removed = diff.files.reduce(0) { $0 + ($1.removed ?? 0) }
                        HStack(spacing: 8) {
                            Text(diff.files.count == 1 ? String(localized: "1 file") : String(localized: "\(diff.files.count) files"))
                            Spacer()
                            Text("+\(added)").foregroundStyle(Color.success)
                            Text("−\(removed)").foregroundStyle(Color.failure)
                            ChangeBar(added: added, removed: removed)
                        }
                        .font(.footnote.weight(.medium).monospacedDigit())
                        .textCase(nil)
                    } footer: {
                        if diff.filesTruncated == true || diff.patchTruncated == true {
                            Text("This change is large; some files are shown on your computer only.")
                        }
                    }
                }
            }
        } else {
            ProgressView()
        }
    }

    private func load() async {
        do {
            diff = try await workspace.turnDiffSummary(runID: runID)
            #if DEBUG
            if !DebugLaunch.diffFileShown, let file = UserDefaults.standard.string(forKey: "CapsuleDiffFile"),
               let match = diff?.files.first(where: { $0.path.hasSuffix(file) }) {
                DebugLaunch.diffFileShown = true
                path = [match.path]
            }
            #endif
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct FileSummaryRow: View {
    let file: TurnDiff.File

    var body: some View {
        HStack(spacing: 12) {
            IconTile(symbol: Icons.file(file.path), tint: .textSecondary, size: 30, background: .subtle)
                .overlay(alignment: .bottomTrailing) {
                    if file.status == "added" || file.status == "deleted" {
                        Image(systemName: file.status == "added" ? "plus.circle.fill" : "minus.circle.fill")
                            .font(.caption)
                            .foregroundStyle(file.status == "added" ? Color.success : Color.failure)
                            .background(Circle().fill(Color.card))
                            .offset(x: 4, y: 4)
                    }
                }
            VStack(alignment: .leading, spacing: 2) {
                Text((file.path as NSString).lastPathComponent).font(.body.weight(.medium)).foregroundStyle(Color.textPrimary)
                let folder = (file.path as NSString).deletingLastPathComponent
                if !folder.isEmpty {
                    Text(folder).font(.caption).foregroundStyle(Color.textMuted).lineLimit(1).truncationMode(.head)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                HStack(spacing: 6) {
                    if let added = file.added { Text("+\(added)").foregroundStyle(Color.success) }
                    if let removed = file.removed, removed > 0 || (file.added ?? 0) == 0 { Text("−\(removed)").foregroundStyle(Color.failure) }
                }
                .font(.caption.monospacedDigit().weight(.medium))
                ChangeBar(added: file.added ?? 0, removed: file.removed ?? 0)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(file.path), \(file.added ?? 0) lines added, \(file.removed ?? 0) removed"))
    }
}

struct FilePatchView: View {
    @Environment(Workspace.self) private var workspace
    let runID: String
    let path: String
    var ask: ((String) -> Void)? = nil
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
                    ContentUnavailableView("No line changes", systemImage: "doc.text", description: Text("Only the file's mode or name changed."))
                } else {
                    PatchLines(file: file, truncated: truncated, ask: ask)
                }
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.screen)
        .navigationTitle((path as NSString).lastPathComponent)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        do {
            let result = try await workspace.turnDiff(runID: runID, file: path)
            let parsed = await Task.detached { UnifiedDiff.parse(result.patch) }.value
            truncated = result.patchTruncated == true
            file = parsed.files.first ?? UnifiedDiff.FilePatch(path: path, lines: [], added: 0, removed: 0, isBinary: false)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// A file's patch as coloured, numbered lines that scroll both ways.
struct PatchLines: View {
    let file: UnifiedDiff.FilePatch
    var truncated = false
    /// When set, tapping lines selects them and the bar sends them to the composer.
    var ask: ((String) -> Void)? = nil
    @State private var viewport: CGFloat = 0
    /// Indexes into `file.lines`, first and last tapped.
    @State private var selection: ClosedRange<Int>?

    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            // At least as wide as the screen and pinned leading: a two-way scroll
            // view centres narrow content, and line tints should run edge to edge.
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(Array(file.lines.enumerated()), id: \.element.id) { index, line in
                    DiffLineRow(line: line, selected: selection?.contains(index) == true)
                        .frame(minWidth: viewport, alignment: .leading)
                        .contentShape(.rect)
                        .onTapGesture { if ask != nil { tap(index) } }
                }
                if truncated {
                    Text("The rest of this file's change is on your computer.")
                        .font(.footnote)
                        .foregroundStyle(Color.textMuted)
                        .padding(16)
                }
            }
            .padding(.vertical, 8)
            .frame(minWidth: viewport, alignment: .leading)
            .textSelection(.enabled)
        }
        // A two-way scroll view centres short content; a patch starts at the top.
        .defaultScrollAnchor(.topLeading)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { viewport = $0 }
        .safeAreaInset(edge: .bottom) {
            if let ask {
                askBar(ask)
            }
        }
        .animation(.snappy(duration: 0.2), value: selection)
    }

    @ViewBuilder private func askBar(_ ask: @escaping (String) -> Void) -> some View {
        if let selection {
            HStack(spacing: 10) {
                Button { self.selection = nil } label: {
                    Image(systemName: "xmark").font(.footnote.weight(.bold)).frame(width: 34, height: 34)
                        .foregroundStyle(Color.textSecondary).background(Color.subtle, in: .circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Clear selection"))
                Button {
                    ask(PatchLines.quote(file, selection))
                    self.selection = nil
                    Haptics.success()
                } label: {
                    Label(selection.count == 1 ? String(localized: "Ask about this line") : String(localized: "Ask about \(selection.count) lines"),
                          systemImage: "text.bubble")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle())
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .glassSurface(cornerRadius: 26)
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        } else {
            Text("Tap lines to ask the agent about them.")
                .font(.caption)
                .foregroundStyle(Color.textTertiary)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity)
                .background(Color.screen)
        }
    }

    private func tap(_ index: Int) {
        guard [.added, .removed, .context].contains(file.lines[index].kind) else { return }
        Haptics.selection()
        if let current = selection {
            if current.contains(index) { selection = current.count == 1 ? nil : index...index }
            else { selection = min(current.lowerBound, index)...max(current.upperBound, index) }
        } else {
            selection = index...index
        }
    }

    /// "`Sources/Forecast.swift` lines 12–18:" and the lines as a diff block.
    static func quote(_ file: UnifiedDiff.FilePatch, _ range: ClosedRange<Int>) -> String {
        let lines = file.lines[range].filter { [.added, .removed, .context].contains($0.kind) }
        let numbers = lines.compactMap { $0.newNumber ?? $0.oldNumber }
        let where_: String = switch (numbers.min(), numbers.max()) {
        case let (low?, high?) where low == high: String(localized: "line \(low)")
        case let (low?, high?): String(localized: "lines \(low)–\(high)")
        default: ""
        }
        let body = lines.map { line in
            (line.kind == .added ? "+" : line.kind == .removed ? "-" : " ") + line.text
        }.joined(separator: "\n")
        return "`\(file.path)` \(where_):\n```diff\n\(body)\n```\n"
    }
}

private struct DiffLineRow: View {
    let line: UnifiedDiff.Line
    var selected = false

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Text(number)
                .frame(minWidth: 44, alignment: .trailing)
                .foregroundStyle(.tertiary)
                .padding(.trailing, 8)
                .accessibilityHidden(true)
            Text(marker)
                .frame(width: 14, alignment: .leading)
                .foregroundStyle(markerColor)
                .accessibilityHidden(true)
            Text(styled)
                .foregroundStyle(line.kind == .hunk || line.kind == .meta ? Color.textMuted : Color.textPrimary)
                .fixedSize(horizontal: true, vertical: false)
                .padding(.trailing, 16)
            Spacer(minLength: 0)
        }
        .font(.footnote.monospaced())
        .padding(.vertical, 1)
        .background(background)
        .overlay(alignment: .leading) {
            if selected { Rectangle().fill(Color.textPrimary).frame(width: 3) }
        }
        .background(selected ? Color.subtleStrong : .clear)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(accessibilityText))
    }

    /// The line, with the words that changed against its pair drawn stronger.
    private var styled: AttributedString {
        var text = AttributedString(line.text.isEmpty ? " " : line.text)
        guard !line.changed.isEmpty else { return text }
        let utf16 = line.text.utf16
        for range in line.changed {
            guard range.upperBound <= utf16.count,
                  let lower = utf16.index(utf16.startIndex, offsetBy: range.lowerBound, limitedBy: utf16.endIndex),
                  let upper = utf16.index(utf16.startIndex, offsetBy: range.upperBound, limitedBy: utf16.endIndex),
                  let from = AttributedString.Index(lower, within: text), let to = AttributedString.Index(upper, within: text)
            else { continue }
            text[from..<to].backgroundColor = line.kind == .added ? Color.success.opacity(0.28) : Color.failure.opacity(0.26)
        }
        return text
    }

    private var number: String {
        switch line.kind {
        case .added: line.newNumber.map(String.init) ?? ""
        case .removed: line.oldNumber.map(String.init) ?? ""
        case .context: line.newNumber.map(String.init) ?? ""
        default: ""
        }
    }

    private var marker: String {
        switch line.kind {
        case .added: "+"
        case .removed: "−"
        default: ""
        }
    }

    private var markerColor: Color { line.kind == .added ? .success : .failure }

    private var background: Color {
        switch line.kind {
        case .added: .diffAdd
        case .removed: .diffRemove
        case .hunk: .subtle
        default: .clear
        }
    }

    private var accessibilityText: String {
        switch line.kind {
        case .added: String(localized: "Added: \(line.text)")
        case .removed: String(localized: "Removed: \(line.text)")
        case .hunk: String(localized: "Section \(line.text)")
        default: line.text
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
