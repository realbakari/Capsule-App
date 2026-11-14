import SwiftUI

struct MessageView: View {
    let message: ChatMessage

    var body: some View {
        switch message.role {
        case .user:
            HStack {
                Spacer(minLength: 56)
                VStack(alignment: .trailing, spacing: 4) {
                    if let attachments = message.attachments, !attachments.isEmpty {
                        AttachmentStrip(messageID: message.id, attachments: attachments)
                    }
                    if message.kind == "steer" {
                        Label("Steered the running turn", systemImage: "arrow.turn.down.right")
                            .font(.caption)
                            .foregroundStyle(Color.textTertiary)
                    }
                    if !message.content.isEmpty {
                    Text(MarkdownBlock.inline(message.content, onBubble: true))
                        .font(.callout)
                        .lineSpacing(3)
                        .foregroundStyle(Color.userBubbleText)
                        .tint(Color.userBubbleText)
                        .textSelection(.enabled)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(Color.userBubble, in: .rect(cornerRadius: 22, style: .continuous))
                        .accessibilityLabel(Text("You: \(message.content)"))
                    }
                }
            }
            .padding(.top, 6)
            .accessibilityElement(children: .contain)
            .contextMenu {
                Text(String(localized: "Sent \(message.createdAt.messageTime)"))
                CopyButton(text: message.content)
            }
        case .assistant:
            VStack(alignment: .leading, spacing: 6) {
                MarkdownView(text: message.content)
                if message.contentTruncated == true {
                    Label("Shortened here. Open it on your computer for the full reply.", systemImage: "text.append")
                        .font(.caption)
                        .foregroundStyle(Color.textTertiary)
                }
            }
            .modifier(ReadingFont())
            .frame(maxWidth: .infinity, alignment: .leading)
            .contextMenu {
                Text(String(localized: "Sent \(message.createdAt.messageTime)"))
                CopyButton(text: message.content)
            }
        case .system:
            Text(message.content)
                .font(.footnote)
                .foregroundStyle(Color.textTertiary)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
    }
}

struct CopyButton: View {
    let text: String
    var body: some View {
        Button {
            UIPasteboard.general.string = text
            Haptics.tap()
        } label: {
            Label("Copy", systemImage: "doc.on.doc")
        }
    }
}

/*
 * Markdown for replies. Blocks (headings, fenced code, quotes, lists, rules)
 * are split here; inline styling inside each block is Foundation's. Code is
 * never wrapped, so it scrolls sideways instead of reflowing into nonsense.
 */
struct MarkdownView: View {
    let text: String

    var body: some View {
        let blocks = MarkdownBlock.cachedParse(text)
        VStack(alignment: .leading, spacing: 12) {
            ForEach(blocks) { block in
                switch block.kind {
                case .paragraph(let body):
                    Text(MarkdownBlock.inline(body))
                        .font(.body)
                        .lineSpacing(5)
                        .foregroundStyle(Color.textPrimary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                case .heading(let level, let body):
                    Text(MarkdownBlock.inline(body))
                        .font(level <= 1 ? .title3.weight(.semibold) : level == 2 ? .headline : .callout.weight(.semibold))
                        .foregroundStyle(Color.textPrimary)
                        .padding(.top, 6)
                        .accessibilityAddTraits(.isHeader)
                case .listItem(let marker, let depth, let body):
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(marker).font(.body.monospacedDigit()).foregroundStyle(Color.textTertiary)
                            .frame(minWidth: 14, alignment: .trailing)
                        Text(MarkdownBlock.inline(body)).font(.body).lineSpacing(5).foregroundStyle(Color.textPrimary).textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.leading, CGFloat(depth) * 16)
                case .quote(let body):
                    Text(MarkdownBlock.inline(body))
                        .font(.body)
                        .lineSpacing(5)
                        .foregroundStyle(Color.textSecondary)
                        .padding(.leading, 12)
                        .overlay(alignment: .leading) { Capsule().fill(Color.subtleStrong).frame(width: 3) }
                case .code(let language, let code):
                    CodeBlock(language: language, code: code)
                case .image(let alt, let url):
                    RemoteImageBlock(alt: alt, url: url)
                case .table(let header, let rows):
                    MarkdownTable(header: header, rows: rows).fontDesign(.default)
                case .rule:
                    Divider()
                }
            }
        }
    }
}

struct CodeBlock: View {
    let language: String?
    let code: String
    @State private var copied = false

    var body: some View {
        content.fontDesign(.default)
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: Icons.file("x.\(language ?? "")"))
                    .font(.caption2)
                    .foregroundStyle(Color.textTertiary)
                Text(language?.isEmpty == false ? language! : String(localized: "code"))
                    .font(.caption.monospaced())
                    .foregroundStyle(Color.textMuted)
                Spacer()
                Button {
                    UIPasteboard.general.string = code
                    Haptics.tap()
                    copied = true
                    Task { try? await Task.sleep(for: .seconds(1.5)); copied = false }
                } label: {
                    Image(systemName: copied ? "checkmark" : "square.on.square")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(copied ? Color.success : Color.textMuted)
                        .contentTransition(.symbolEffect(.replace))
                        .frame(width: 28, height: 24)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(copied ? "Copied" : "Copy code"))
            }
            .padding(.leading, 12)
            .padding(.trailing, 6)
            .padding(.vertical, 4)
            ScrollView(.horizontal, showsIndicators: false) {
                Text(Highlighted.code(code, language: SyntaxHighlighter.language(language), key: language ?? ""))
                    .font(.footnote.monospaced())
                    .monospaced()
                    .lineSpacing(2)
                    .foregroundStyle(Color.textPrimary)
                    .textSelection(.enabled)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 12)
                    .padding(.top, 2)
            }
        }
        .background(Color.codeBackground, in: .rect(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .contain)
    }
}

nonisolated struct MarkdownBlock: Identifiable, Equatable {
    enum Kind: Equatable {
        case paragraph(String)
        case heading(Int, String)
        case listItem(marker: String, depth: Int, String)
        case quote(String)
        case code(String?, String)
        case table(header: [String], rows: [[String]])
        case image(alt: String, url: String)
        case rule
    }
    let id: Int
    let kind: Kind

    /// Inline Markdown, with code spans set as small tinted chips and links underlined.
    static func inline(_ text: String, onBubble: Bool = false) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace, failurePolicy: .returnPartiallyParsedIfPossible)
        var result = (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
        for run in result.runs {
            if run.inlinePresentationIntent?.contains(.code) == true {
                result[run.range].font = .system(.footnote, design: .monospaced).weight(.medium)
                result[run.range].backgroundColor = onBubble ? Color.subtleStrong : Color.codeBackground
            }
            if run.link != nil {
                result[run.range].underlineStyle = .single
            }
        }
        return result
    }

    nonisolated(unsafe) private static let cache: NSCache<NSString, Box> = {
        let cache = NSCache<NSString, Box>()
        cache.countLimit = 300
        return cache
    }()
    final class Box { let blocks: [MarkdownBlock]; init(_ blocks: [MarkdownBlock]) { self.blocks = blocks } }

    /// Parsing is cheap but runs on every body; long transcripts re-render often.
    static func cachedParse(_ text: String) -> [MarkdownBlock] {
        let key = text as NSString
        if let hit = cache.object(forKey: key) { return hit.blocks }
        let blocks = parse(text)
        cache.setObject(Box(blocks), forKey: key)
        return blocks
    }

    static func parse(_ text: String) -> [MarkdownBlock] {
        var kinds: [Kind] = []
        var paragraph: [String] = []
        var quote: [String] = []
        var fence: (marker: String, language: String?, lines: [String])?
        var table: [String] = []

        func flushTable() {
            guard !table.isEmpty else { return }
            let rows = table.map(cells)
            // A table needs a header and a --- separator; otherwise it's just text with bars.
            if rows.count >= 2, rows[1].allSatisfy({ $0.allSatisfy { "-: ".contains($0) } && $0.contains("-") }) {
                kinds.append(.table(header: rows[0], rows: Array(rows.dropFirst(2))))
            } else {
                kinds.append(.paragraph(table.joined(separator: "\n")))
            }
            table = []
        }
        func flush() {
            flushTable()
            // A single newline inside a paragraph is a soft break, which reads as a
            // space. Only an explicit backslash keeps the break: agents leave stray
            // trailing spaces that would otherwise chop sentences in half.
            if !paragraph.isEmpty {
                var text = ""
                for (index, line) in paragraph.enumerated() {
                    if index > 0 { text += text.hasSuffix("\\") ? "\n" : " " }
                    text += line
                }
                kinds.append(.paragraph(text.replacingOccurrences(of: "\\\n", with: "\n")))
                paragraph = []
            }
            if !quote.isEmpty { kinds.append(.quote(quote.joined(separator: " "))); quote = [] }
        }

        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        for raw in normalized.components(separatedBy: "\n") {
            let line = raw.replacingOccurrences(of: "\t", with: "    ")
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if var open = fence {
                if trimmed.hasPrefix(open.marker) {
                    kinds.append(.code(open.language, open.lines.joined(separator: "\n")))
                    fence = nil
                } else {
                    open.lines.append(line)
                    fence = open
                }
                continue
            }
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                flush()
                let marker = String(trimmed.prefix(3))
                let language = trimmed.dropFirst(3).trimmingCharacters(in: .whitespaces)
                fence = (marker, language.isEmpty ? nil : language, [])
                continue
            }
            if trimmed.isEmpty { flush(); continue }
            if let image = imageLine(trimmed) {
                flush()
                kinds.append(.image(alt: image.alt, url: image.url))
                continue
            }
            if trimmed.hasPrefix("|") {
                if !paragraph.isEmpty || !quote.isEmpty { let pending = table; table = []; flush(); table = pending }
                table.append(trimmed)
                continue
            }
            flushTable()
            if trimmed == "---" || trimmed == "***" || trimmed == "___" { flush(); kinds.append(.rule); continue }
            if let hashes = trimmed.firstIndex(where: { $0 != "#" }), trimmed.hasPrefix("#") {
                let level = trimmed.distance(from: trimmed.startIndex, to: hashes)
                if level <= 6, trimmed[hashes] == " " {
                    flush()
                    kinds.append(.heading(level, trimmed[hashes...].trimmingCharacters(in: .whitespaces)))
                    continue
                }
            }
            if trimmed.hasPrefix(">") {
                if !paragraph.isEmpty { flush() }
                quote.append(trimmed.dropFirst().trimmingCharacters(in: .whitespaces))
                continue
            }
            let indent = line.prefix { $0 == " " }.count
            if let item = listItem(trimmed) {
                flush()
                kinds.append(.listItem(marker: item.marker, depth: min(indent / 2, 4), item.body))
                continue
            }
            if !quote.isEmpty { flush() }
            paragraph.append(trimmed)
        }
        if let open = fence { kinds.append(.code(open.language, open.lines.joined(separator: "\n"))) }
        flush()
        return kinds.enumerated().map { MarkdownBlock(id: $0.offset, kind: $0.element) }
    }

    /// A line that is only `![alt](url)`.
    static func imageLine(_ line: String) -> (alt: String, url: String)? {
        guard line.hasPrefix("!["), line.hasSuffix(")"),
              let close = line.range(of: "]("), close.lowerBound > line.index(line.startIndex, offsetBy: 1) else { return nil }
        let alt = String(line[line.index(line.startIndex, offsetBy: 2)..<close.lowerBound])
        let url = String(line[close.upperBound..<line.index(before: line.endIndex)]).trimmingCharacters(in: .whitespaces)
        guard !url.isEmpty, !url.contains(" ") else { return nil }
        return (alt, url)
    }

    private static func cells(_ line: String) -> [String] {
        var body = line.trimmingCharacters(in: .whitespaces)
        if body.hasPrefix("|") { body.removeFirst() }
        if body.hasSuffix("|") { body.removeLast() }
        return body.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private static func listItem(_ line: String) -> (marker: String, body: String)? {
        for bullet in ["- [ ] ", "- [x] ", "- [X] "] where line.hasPrefix(bullet) {
            return (bullet.contains("x") || bullet.contains("X") ? "☑" : "☐", String(line.dropFirst(bullet.count)))
        }
        for bullet in ["- ", "* ", "+ "] where line.hasPrefix(bullet) {
            return ("•", String(line.dropFirst(2)))
        }
        let digits = line.prefix { $0.isNumber }
        if !digits.isEmpty, digits.count <= 3 {
            let rest = line.dropFirst(digits.count)
            if rest.hasPrefix(". ") || rest.hasPrefix(") ") { return ("\(digits).", String(rest.dropFirst(2))) }
        }
        return nil
    }
}

/// A Markdown table: a grid that scrolls sideways when it's wider than the screen.
struct MarkdownTable: View {
    let header: [String]
    let rows: [[String]]

    var body: some View {
        ScrollView(.horizontal) {
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                GridRow {
                    ForEach(Array(header.enumerated()), id: \.offset) { _, cell in
                        Text(MarkdownBlock.inline(cell)).font(.subheadline.weight(.semibold))
                    }
                }
                Divider()
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    GridRow {
                        ForEach(Array(header.indices), id: \.self) { column in
                            Text(MarkdownBlock.inline(column < row.count ? row[column] : ""))
                                .font(.subheadline)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: 280, alignment: .leading)
                        }
                    }
                }
            }
            .padding(12)
        }
        .background(Color.card, in: .rect(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.hairline, lineWidth: 0.5))
        .textSelection(.enabled)
    }
}

/// Images sent with a message: the computer's previews, tap for a closer look.
struct AttachmentStrip: View {
    let messageID: String
    let attachments: [MessageAttachment]
    @State private var viewing: ImageViewer.Request?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(attachments.enumerated()), id: \.offset) { index, file in
                    if file.isImage {
                        Button {
                            viewing = ImageViewer.Request(messageID: messageID, index: index, preview: file.thumbnail, name: file.name)
                        } label: {
                            Group {
                                if let image = ProjectIconCache.image(for: file.thumbnail) {
                                    Image(uiImage: image).resizable().scaledToFill()
                                } else {
                                    Image(systemName: "photo").font(.title2).foregroundStyle(Color.textMuted)
                                        .frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.subtle)
                                }
                            }
                            .frame(width: 96, height: 72)
                            .clipShape(.rect(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.hairline, lineWidth: 0.5))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Image \(file.name)"))
                        .accessibilityHint(Text("Opens a larger view."))
                    } else {
                        Label(file.name, systemImage: Icons.file(file.name))
                            .font(.caption)
                            .lineLimit(1)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .background(Color.subtle, in: .capsule)
                            .foregroundStyle(Color.textSecondary)
                    }
                }
            }
        }
        .frame(maxWidth: 280)
        .sheet(item: $viewing) { request in ImageViewer(request: request) }
    }
}

/// A zoomable image with share, from the computer's preview.
struct ImageViewer: View {
    struct Request: Identifiable {
        let messageID: String
        let index: Int
        let preview: String?
        let name: String
        var id: String { "\(messageID)-\(index)" }
    }
    @Environment(Workspace.self) private var workspace
    @Environment(\.dismiss) private var dismiss
    let request: Request
    @State private var image: UIImage?
    @State private var scale: CGFloat = 1

    var body: some View {
        NavigationStack {
            Group {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .scaleEffect(scale)
                        .gesture(MagnifyGesture().onChanged { scale = max(1, min(5, $0.magnification)) }
                            .onEnded { _ in withAnimation(.snappy) { if scale < 1.1 { scale = 1 } } })
                        .onTapGesture(count: 2) { withAnimation(.snappy) { scale = scale > 1 ? 1 : 2.5 } }
                        .accessibilityLabel(Text(request.name))
                } else {
                    ProgressView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.screen)
            .navigationTitle(request.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.keyboardShortcut(.cancelAction) }
                if let image {
                    ToolbarItem(placement: .topBarLeading) {
                        ShareLink(item: Image(uiImage: image), preview: SharePreview(request.name, image: Image(uiImage: image)))
                    }
                }
            }
        }
        .task {
            image = ProjectIconCache.image(for: request.preview)
            if let fetched = try? await workspace.messageImage(messageID: request.messageID, index: request.index),
               let better = ProjectIconCache.image(for: fetched) {
                if (image?.size.width ?? 0) < better.size.width { image = better }
            }
        }
    }
}

/// `![alt](url)` from an agent. Nothing is fetched until it's tapped, so a
/// reply can't make the phone call out to a server on its own.
struct RemoteImageBlock: View {
    let alt: String
    let url: String
    @State private var load = false

    var body: some View {
        if load, let target = URL(string: url), target.scheme == "https" {
            AsyncImage(url: target) { phase in
                switch phase {
                case .success(let image): image.resizable().scaledToFit().clipShape(.rect(cornerRadius: 12))
                case .failure: Label("Couldn't load the image", systemImage: "photo.badge.exclamationmark").font(.footnote).foregroundStyle(Color.textMuted)
                default: ProgressView().frame(maxWidth: .infinity, minHeight: 80)
                }
            }
            .frame(maxHeight: 360)
            .accessibilityLabel(Text(alt.isEmpty ? String(localized: "Image") : alt))
        } else {
            Button {
                load = true
            } label: {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(alt.isEmpty ? String(localized: "Image") : alt).font(.subheadline.weight(.medium))
                        Text(URL(string: url)?.host() ?? url).font(.caption).foregroundStyle(Color.textTertiary).lineLimit(1)
                    }
                } icon: {
                    Image(systemName: "photo")
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.subtle, in: .rect(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.textSecondary)
            .disabled(URL(string: url)?.scheme != "https")
            .accessibilityHint(Text("Loads the image from the internet."))
        }
    }
}
