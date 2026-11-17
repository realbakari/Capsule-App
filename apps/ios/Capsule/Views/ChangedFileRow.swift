import SwiftUI

/// A file's kind as a small tinted tile: an SF Symbol, or letters where no symbol fits.
struct FileGlyph: View {
    let path: String
    var size: CGFloat = 26
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    var body: some View {
        let kind = FileKind.of(path)
        let side = size * min(scale, 1.6)
        let tint = Self.color(kind.tone)
        Group {
            switch kind.mark {
            case .symbol(let name):
                Image(systemName: name).font(.system(size: side * 0.46, weight: .medium))
            case .letters(let text):
                Text(verbatim: text).font(.system(size: side * (text.count > 1 ? 0.36 : 0.44), weight: .bold, design: .rounded))
                    .tracking(-0.3)
            }
        }
        .foregroundStyle(tint)
        .frame(width: side, height: side)
        .background(tint.opacity(0.13), in: .rect(cornerRadius: side * 0.26, style: .continuous))
        .accessibilityHidden(true)
    }

    static func color(_ tone: FileKind.Tone) -> Color {
        switch tone {
        case .keyword: Color("SyntaxKeyword")
        case .string: Color("SyntaxString")
        case .number: Color("SyntaxNumber")
        case .attention: .attention
        case .success: .success
        case .failure: .failure
        case .muted: .textMuted
        }
    }
}

/// The source-control letter for a change: A, M, D, R or U.
struct StatusLetter: View {
    let status: ChangeStatus

    var body: some View {
        Text(verbatim: status.letter)
            .font(.caption.weight(.semibold).monospaced())
            .foregroundStyle(Self.tint(status))
            .frame(minWidth: 12)
            .accessibilityHidden(true)
    }

    static func tint(_ status: ChangeStatus) -> Color {
        switch status {
        case .added, .untracked: .success
        case .deleted: .failure
        case .renamed: .attention
        case .modified: .textTertiary
        }
    }
}

/// "+12 −3", leaving out a zero side unless both are zero.
struct LineCounts: View {
    let added: Int?
    let removed: Int?

    var body: some View {
        HStack(spacing: 5) {
            if let added, added > 0 || (removed ?? 0) == 0 { Text(verbatim: "+\(added)").foregroundStyle(Color.success) }
            if let removed, removed > 0 { Text(verbatim: "−\(removed)").foregroundStyle(Color.failure) }
        }
        .font(.caption.monospacedDigit().weight(.medium))
        .accessibilityHidden(true)
    }
}

/*
 * One changed file in a list: kind, name, counts, status letter. The folder
 * belongs to the section header, so a row repeats only what tells it apart;
 * a flat list passes the folder as `detail`.
 */
struct ChangedFileRow: View {
    let path: String
    let status: ChangeStatus?
    let added: Int?
    let removed: Int?
    var detail: String? = nil
    var viewed = false

    private var name: String { (path as NSString).lastPathComponent }

    var body: some View {
        HStack(spacing: 12) {
            FileGlyph(path: path)
                .opacity(viewed ? 0.55 : 1)
            VStack(alignment: .leading, spacing: 1) {
                Text(name)
                    .font(.body)
                    .strikethrough(status == .deleted, color: .textMuted)
                    .foregroundStyle(viewed || status == .deleted ? Color.textSecondary : Color.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if let detail, !detail.isEmpty {
                    Text(detail).font(.subheadline).foregroundStyle(Color.textMuted).lineLimit(1).truncationMode(.middle)
                }
            }
            .layoutPriority(1)
            Spacer(minLength: 8)
            if viewed {
                Image(systemName: "checkmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(Color.textTertiary)
                    .accessibilityHidden(true)
            } else {
                LineCounts(added: added, removed: removed)
            }
            if let status { StatusLetter(status: status) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(accessibilityText))
    }

    private var accessibilityText: String {
        var parts = [name]
        if let detail, !detail.isEmpty { parts.append(detail) }
        if let status { parts.append(status.spoken) }
        if let added { parts.append(String(localized: "\(added) lines added")) }
        if let removed { parts.append(String(localized: "\(removed) removed")) }
        if viewed { parts.append(String(localized: "viewed")) }
        return parts.joined(separator: ", ")
    }
}

/// A folder's name over its files, shortened in the middle so both ends stay readable.
struct FolderHeader: View {
    let folder: String

    var body: some View {
        Label {
            Text(folder).lineLimit(1).truncationMode(.middle)
        } icon: {
            Image(systemName: "folder").imageScale(.small)
        }
        .font(.footnote)
        .foregroundStyle(Color.textMuted)
        .textCase(nil)
    }
}
