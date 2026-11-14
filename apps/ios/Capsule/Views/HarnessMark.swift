import SwiftUI

/*
 * The mark for the agent a thread runs on, the same marks the desktop draws.
 *
 * The vector assets in Assets.xcassets/Harness are generated from the
 * desktop's `apps/desktop/src/renderer/src/lib/provider-marks.ts`, itself
 * drawn from the MIT-licensed @lobehub/icons-static-svg set (Copyright (c)
 * LobeHub). The trademarks belong to the products they identify; they appear
 * only to name the agent. An agent without a mark gets a monogram, as on the
 * desktop, rather than an invented logo.
 */
struct Harness: Equatable {
    /// The asset key when the product has a mark ("claude", "gemini"…).
    let markKey: String?
    /// Brand colour, where people know the product by it.
    let hex: String?
    let name: String

    private static let marks: [String: (title: String, hex: String?)] = [
        "claude": ("Claude", "#d97757"),
        "codex": ("Codex", nil),
        "grok": ("Grok", nil),
        "copilot": ("Copilot", nil),
        "cursor": ("Cursor", nil),
        "gemini": ("Gemini", "#8e75b2"),
        "kilocode": ("Kilo Code", nil),
        "kimi": ("Kimi", nil),
        "kiro": ("Kiro", nil),
        "opencode": ("opencode", nil),
        "qoder": ("Qoder", nil),
        "qwen": ("Qwen", "#6950ef"),
        "trae": ("TRAE", "#32f08c"),
    ]

    /// From a harness or agent id. A variant (`gemini-flash`, `claude-code`) wears its product's mark.
    init?(_ id: String?) {
        guard let id = id?.lowercased(), !id.isEmpty else { return nil }
        let key = Self.marks[id] != nil ? id : id.split(separator: "-").first.map(String.init).flatMap { Self.marks[$0] != nil ? $0 : nil }
        markKey = key
        hex = key.flatMap { Self.marks[$0]?.hex }
        name = AgentName.display(id) ?? id
    }

    /// From an approval's agent name ("Claude Code"), when there's no id.
    init?(name: String?) {
        guard let name, !name.isEmpty else { return nil }
        let lower = name.lowercased()
        if let key = Self.marks.keys.sorted().first(where: { lower.contains($0) }) {
            self.init(key)
        } else {
            self.init(markKey: nil, hex: nil, name: name)
        }
    }

    private init(markKey: String?, hex: String?, name: String) {
        self.markKey = markKey
        self.hex = hex
        self.name = name
    }

    /// "Claude Code" is CC, "Kimi" is KI, as on the desktop.
    var initials: String {
        let words = name.replacingOccurrences(of: "-", with: " ").replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
        guard let first = words.first else { return "?" }
        if words.count == 1 { return String(first.prefix(2)).uppercased() }
        return words.prefix(2).map { String($0.prefix(1)).uppercased() }.joined()
    }

    /// The brand colour while it still reads; otherwise nil, and the mark takes the text colour.
    var accent: Color? {
        guard let hex, hex.count == 7, let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        let r = Double((value >> 16) & 0xFF) / 255, g = Double((value >> 8) & 0xFF) / 255, b = Double(value & 0xFF) / 255
        guard 0.2126 * r + 0.7152 * g + 0.0722 * b >= 0.12 else { return nil }
        return Color(red: r, green: g, blue: b)
    }
}

struct HarnessMark: View {
    let harness: Harness
    @ScaledMetric private var side: CGFloat

    init(_ harness: Harness, size: CGFloat = 16) {
        self.harness = harness
        _side = ScaledMetric(wrappedValue: size, relativeTo: .footnote)
    }

    var body: some View {
        Group {
            if let key = harness.markKey {
                Image("harness-\(key)")
                    .resizable()
                    .renderingMode(.template)
                    .scaledToFit()
                    .foregroundStyle(harness.accent ?? Color.textSecondary)
                    .frame(width: side, height: side)
            } else {
                Text(harness.initials)
                    .font(.system(size: side * 0.5, weight: .semibold))
                    .tracking(0.2)
                    .foregroundStyle(harness.accent ?? Color.textMuted)
                    .frame(width: side, height: side)
                    .background(Color.subtle, in: .rect(cornerRadius: side * 0.25, style: .continuous))
            }
        }
        .accessibilityHidden(true)
    }
}

#Preview {
    VStack(alignment: .leading, spacing: 14) {
        ForEach([13.0, 16, 20, 40], id: \.self) { size in
            HStack(spacing: 14) {
                ForEach(["codex", "claude-code", "grok-build", "gemini", "aider"], id: \.self) { id in
                    if let harness = Harness(id) { HarnessMark(harness, size: size) }
                }
            }
        }
    }
    .padding()
}
