import SwiftUI

/*
 * A file's patch as coloured, numbered lines. Lines wrap by default; with
 * Wrap lines off they keep their shape and the patch scrolls sideways. The
 * gutter shows the new line number, and the old one on a removed line, tinted
 * so it reads as the old file's.
 */
struct PatchLines: View {
    let file: UnifiedDiff.FilePatch
    var truncated = false
    /// When set, tapping lines selects them and the bar sends them to the composer.
    var ask: ((String) -> Void)? = nil
    /// When set, selected lines can also take a note, kept with the others until they're sent.
    var notes: ReviewNotes? = nil
    @AppStorage("diff.wrap") private var wrap = true
    @AppStorage("diff.askHintSeen") private var askHintSeen = false
    @State private var viewport: CGFloat = 0
    /// Indexes into `file.lines`, first and last tapped.
    @State private var selection: ClosedRange<Int>?
    /// The lines a note is being written for.
    @State private var commenting: ClosedRange<Int>?

    private var language: SyntaxHighlighter.Language? { SyntaxHighlighter.language(forPath: file.path) }

    /// Wide enough for the largest line number, so short files get a narrow gutter.
    private var gutterSample: String {
        let largest = file.lines.reduce(0) { max($0, $1.newNumber ?? 0, $1.oldNumber ?? 0) }
        return String(repeating: "8", count: max(2, String(largest).count))
    }

    var body: some View {
        Group {
            if wrap {
                ScrollView(.vertical) { rows }
            } else {
                ScrollView([.vertical, .horizontal]) {
                    // At least as wide as the screen and pinned leading: a two-way scroll
                    // view centres narrow content, and line tints should run edge to edge.
                    rows.frame(minWidth: viewport, alignment: .leading)
                }
                .defaultScrollAnchor(.topLeading)
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { viewport = $0 }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let ask { askBar(ask) }
        }
        .toolbar {
            ToolbarItem(placement: .secondaryAction) {
                Toggle("Wrap lines", systemImage: "arrow.turn.down.left", isOn: $wrap)
            }
        }
        .animation(.snappy(duration: 0.2), value: selection)
        .sheet(isPresented: Binding(get: { commenting != nil }, set: { if !$0 { commenting = nil } })) {
            if let range = commenting {
                CommentComposer(quote: PatchLines.excerpt(file, range)) { text in
                    if let comment = PatchLines.comment(on: file, range, text: text) { notes?.add(comment); Haptics.success() }
                    selection = nil
                }
            }
        }
    }

    /// Notes by the index of the line each one ends on.
    private var anchored: [Int: [ReviewComment]] {
        guard let notes, !notes.comments.isEmpty else { return [:] }
        var result: [Int: [ReviewComment]] = [:]
        for comment in notes.comments {
            if let index = PatchLines.anchor(of: comment, in: file) { result[index, default: []].append(comment) }
        }
        return result
    }

    private var rows: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            if let oldPath = file.oldPath {
                Label {
                    Text("Renamed from \(oldPath)")
                } icon: {
                    Image(systemName: "arrow.right")
                }
                .font(.caption)
                .foregroundStyle(Color.textMuted)
                .padding(.horizontal, 12)
                .padding(.bottom, 6)
            }
            let anchored = anchored
            ForEach(Array(file.lines.enumerated()), id: \.element.id) { index, line in
                row(index, line)
                ForEach(anchored[index] ?? []) { comment in
                    CommentCard(comment: comment, width: viewport) { notes?.remove(comment.id) }
                }
            }
            if truncated {
                Text("The rest of this file's change is on your computer.")
                    .font(.footnote)
                    .foregroundStyle(Color.textMuted)
                    .padding(16)
            }
        }
        .padding(.vertical, 8)
        .textSelection(.enabled)
    }

    @ViewBuilder private func row(_ index: Int, _ line: UnifiedDiff.Line) -> some View {
        switch line.kind {
        case .hunk:
            HunkSeparator(header: line.text, first: index == file.lines.firstIndex { $0.kind == .hunk })
        case .meta:
            Text(line.text.hasPrefix("\\") ? String(localized: "No newline at end of file") : line.text)
                .font(.caption.italic())
                .foregroundStyle(Color.textMuted)
                .padding(.leading, 12)
                .padding(.vertical, 2)
        default:
            DiffLineRow(line: line, gutter: gutterSample, wrap: wrap, language: language, key: file.path,
                        selected: selection?.contains(index) == true)
                .contentShape(.rect)
                .onTapGesture { if ask != nil { tap(index) } }
        }
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
                if notes != nil {
                    Button { commenting = selection } label: {
                        Label("Comment", systemImage: "plus.bubble")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.textPrimary)
                            .padding(.horizontal, 14)
                            .frame(height: 40)
                            .background(Color.subtle, in: .capsule)
                    }
                    .buttonStyle(.plain)
                }
                Button {
                    ask(PatchLines.quote(file, selection))
                    self.selection = nil
                    Haptics.success()
                } label: {
                    Label(selection.count == 1 ? String(localized: "Ask about 1 line") : String(localized: "Ask about \(selection.count) lines"),
                          systemImage: "text.bubble")
                        .lineLimit(1)
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
        } else if !askHintSeen {
            // Shown until the first tap or dismissal, then never again.
            HStack(spacing: 8) {
                Image(systemName: "hand.tap").foregroundStyle(Color.textSecondary)
                Text("Tap lines to ask the agent about them.").foregroundStyle(Color.textSecondary)
                Spacer(minLength: 4)
                Button { askHintSeen = true } label: {
                    Image(systemName: "xmark").font(.caption2.weight(.bold)).foregroundStyle(Color.textMuted)
                        .frame(width: 28, height: 28).contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Dismiss"))
            }
            .font(.footnote)
            .padding(.leading, 14)
            .padding(.trailing, 6)
            .padding(.vertical, 6)
            .glassSurface(cornerRadius: 20)
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
            .transition(.opacity)
        }
    }

    private func tap(_ index: Int) {
        guard [.added, .removed, .context].contains(file.lines[index].kind) else { return }
        Haptics.selection()
        askHintSeen = true
        if let current = selection {
            if current.contains(index) { selection = current.count == 1 ? nil : index...index }
            else { selection = min(current.lowerBound, index)...max(current.upperBound, index) }
        } else {
            selection = index...index
        }
    }

    /// The selected lines that can be quoted: not hunk headers or notes about the patch.
    static func codeLines(_ file: UnifiedDiff.FilePatch, _ range: ClosedRange<Int>) -> [UnifiedDiff.Line] {
        guard !file.lines.isEmpty else { return [] }
        return file.lines[range.clamped(to: 0...(file.lines.count - 1))].filter { [.added, .removed, .context].contains($0.kind) }
    }

    /// The lines as they read in the patch, for the note sheet.
    static func excerpt(_ file: UnifiedDiff.FilePatch, _ range: ClosedRange<Int>) -> String {
        codeLines(file, range).map { ($0.kind == .added ? "+" : $0.kind == .removed ? "−" : " ") + $0.text }.joined(separator: "\n")
    }

    /*
     * A note on the selected lines. Numbers count in the new file unless every
     * selected line was removed, when only the old file has them.
     */
    static func comment(on file: UnifiedDiff.FilePatch, _ range: ClosedRange<Int>, text: String) -> ReviewComment? {
        let lines = codeLines(file, range)
        let removed = !lines.isEmpty && lines.allSatisfy { $0.kind == .removed }
        let numbers = lines.compactMap { removed ? $0.oldNumber : $0.newNumber }
        guard let low = numbers.min(), let high = numbers.max(), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return ReviewComment(path: file.path, lines: low...high, removed: removed, text: text.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    /// The index of the line a note ends on, where its card is drawn.
    static func anchor(of comment: ReviewComment, in file: UnifiedDiff.FilePatch) -> Int? {
        file.lines.lastIndex { line in
            comment.removed ? line.kind == .removed && line.oldNumber == comment.lines.upperBound
                : line.kind != .removed && line.newNumber == comment.lines.upperBound
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

/// "Lines 26–32 · struct ForecastView" in place of a raw `@@` header.
private struct HunkSeparator: View {
    let header: String
    let first: Bool

    var body: some View {
        let hunk = UnifiedDiff.Hunk.parse(header)
        HStack(spacing: 6) {
            Text(hunk?.lines ?? header)
                .font(.caption.weight(.medium))
                .foregroundStyle(Color.textSecondary)
                .fixedSize()
            if let context = hunk?.context, !context.isEmpty {
                Text(verbatim: "·").foregroundStyle(Color.textTertiary)
                Text(context)
                    .font(.caption.monospaced())
                    .foregroundStyle(Color.textMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.subtle.opacity(0.7))
        .padding(.top, first ? 0 : 10)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

private struct DiffLineRow: View {
    let line: UnifiedDiff.Line
    /// The widest number in the file, laid out hidden to size the gutter.
    let gutter: String
    let wrap: Bool
    let language: SyntaxHighlighter.Language?
    let key: String
    var selected = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            ZStack(alignment: .trailing) {
                Text(verbatim: gutter).hidden()
                Text(verbatim: number).foregroundStyle(numberColor)
            }
            .padding(.leading, 8)
            .padding(.trailing, 6)
            .accessibilityHidden(true)
            Text(verbatim: marker)
                .frame(width: 12, alignment: .leading)
                .foregroundStyle(markerColor)
                .accessibilityHidden(true)
            Text(styled)
                // Code has no language, so wrapping never hyphenates it: a broken word must not gain a "-".
                .typesettingLanguage(.explicit(Locale.Language(identifier: "zxx")))
                .foregroundStyle(Color.textPrimary)
                .fixedSize(horizontal: !wrap, vertical: wrap)
                .frame(maxWidth: wrap ? .infinity : nil, alignment: .leading)
                .padding(.trailing, 12)
            if !wrap { Spacer(minLength: 0) }
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

    /// The line in syntax colour, with the words that changed against its pair drawn stronger.
    private var styled: AttributedString {
        guard !line.text.isEmpty else { return AttributedString(" ") }
        var text = Highlighted.code(line.text, language: language, key: key)
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
        case .removed: line.oldNumber.map(String.init) ?? ""
        default: line.newNumber.map(String.init) ?? ""
        }
    }

    private var numberColor: Color { line.kind == .removed ? Color.failure.opacity(0.8) : Color.textTertiary }

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
        default: .clear
        }
    }

    private var accessibilityText: String {
        switch line.kind {
        case .added: String(localized: "Added, line \(number): \(line.text)")
        case .removed: String(localized: "Removed, old line \(number): \(line.text)")
        default: String(localized: "Line \(number): \(line.text)")
        }
    }
}

/// Notes on one file's lines, and how to add or drop one.
struct ReviewNotes {
    let comments: [ReviewComment]
    let add: (ReviewComment) -> Void
    let remove: (ReviewComment.ID) -> Void
}

/// A note under the lines it's about.
private struct CommentCard: View {
    let comment: ReviewComment
    let width: CGFloat
    let remove: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "text.bubble.fill").font(.footnote).foregroundStyle(Color.textMuted)
            VStack(alignment: .leading, spacing: 2) {
                Text(comment.text).font(.subheadline).foregroundStyle(Color.textPrimary)
                Text(comment.lines.count == 1 ? String(localized: "Line \(comment.lines.lowerBound)")
                     : String(localized: "Lines \(comment.lines.lowerBound)–\(comment.lines.upperBound)"))
                    .font(.caption).foregroundStyle(Color.textMuted)
            }
            Spacer(minLength: 4)
            Button(role: .destructive, action: remove) {
                Image(systemName: "trash").font(.footnote).foregroundStyle(Color.textMuted).frame(width: 28, height: 28).contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Delete comment"))
        }
        .padding(10)
        .background(Color.card, in: .rect(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color.hairline, lineWidth: 0.5))
        .frame(width: max(width - 24, 200), alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .textSelection(.disabled)
    }
}

/// Writing a note on selected lines.
private struct CommentComposer: View {
    let quote: String
    let add: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            CapsuleForm {
                Section {
                    Text(quote).font(.caption.monospaced()).foregroundStyle(Color.textSecondary).lineLimit(6)
                }
                Section {
                    TextField("What should change here?", text: $text, axis: .vertical)
                        .lineLimit(3...8)
                        .focused($focused)
                } footer: {
                    Text("Comments wait here until you add them to the message.")
                }
            }
            .navigationTitle("Comment")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { add(text); dismiss() }
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium, .large])
    }
}
