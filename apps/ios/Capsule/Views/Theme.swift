import SwiftUI
import UIKit

/// The palette, from the asset catalog. Every colour has a dark variant.
extension Color {
    nonisolated static let screen = Color("Screen")
    nonisolated static let card = Color("Card")
    nonisolated static let cardAlt = Color("CardAlt")
    nonisolated static let textPrimary = Color("TextPrimary")
    nonisolated static let textSecondary = Color("TextSecondary")
    nonisolated static let textMuted = Color("TextMuted")
    nonisolated static let textTertiary = Color("TextTertiary")
    nonisolated static let hairline = Color("Hairline")
    nonisolated static let subtle = Color("Subtle")
    nonisolated static let subtleStrong = Color("SubtleStrong")
    nonisolated static let codeBackground = Color("CodeBackground")
    nonisolated static let userBubble = Color("UserBubble")
    nonisolated static let userBubbleText = Color("UserBubbleText")
    nonisolated static let unreadDot = Color("UnreadDot")
    nonisolated static let attention = Color("Attention")
    nonisolated static let attentionBackground = Color("AttentionBackground")
    nonisolated static let success = Color("Success")
    nonisolated static let failure = Color("Failure")
    nonisolated static let failureBackground = Color("FailureBackground")
    nonisolated static let diffAdd = Color("DiffAdd")
    nonisolated static let diffRemove = Color("DiffRemove")
    nonisolated static let primaryFill = Color("Primary")
    nonisolated static let primaryText = Color("PrimaryText")
    nonisolated static let brand = Color("Brand")
    nonisolated static let brandText = Color("BrandText")
}

extension ThreadStatus {
    var label: LocalizedStringResource? {
        switch self {
        case .idle: nil
        case .working: "Working"
        case .needsApproval: "Needs you"
        case .failed: "Failed"
        case .stopped: "Stopped"
        case .unread: "New"
        }
    }

    var tint: Color {
        switch self {
        case .idle, .stopped: .textTertiary
        case .working: .textSecondary
        case .needsApproval: .attention
        case .failed: .failure
        case .unread: .unreadDot
        }
    }
}

// MARK: Icons

/*
 * Icons carry meaning here, not decoration: what kind of step a tool call
 * was, what kind of file changed, and which project or agent a row belongs
 * to. All are SF Symbols or drawn from the project's own icon, so they
 * follow Dynamic Type, weight and both appearances.
 */
enum Icons {
    static func tool(kind: String?) -> String {
        switch kind {
        case "execute": "apple.terminal"
        case "edit": "pencil.line"
        case "read": "doc.text.magnifyingglass"
        case "search": "magnifyingglass"
        case "fetch": "globe"
        case "think": "sparkle"
        case "delete": "trash"
        case "move": "arrow.right.doc.on.clipboard"
        case "switch_mode": "arrow.triangle.branch"
        default: "wrench.adjustable"
        }
    }

    static func file(_ path: String) -> String {
        let name = (path as NSString).lastPathComponent.lowercased()
        let ext = (name as NSString).pathExtension
        if name == "package.json" || name == "cargo.toml" || name == "project.yml" || name.hasSuffix(".lock") { return "shippingbox" }
        if name.hasPrefix("readme") || ext == "md" || ext == "mdx" { return "doc.richtext" }
        if name.hasPrefix(".") || ["json", "yml", "yaml", "toml", "plist", "xcprivacy", "env"].contains(ext) { return "gearshape" }
        switch ext {
        case "swift": return "swift"
        case "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "m", "sh", "zsh":
            return "chevron.left.forwardslash.chevron.right"
        case "css", "scss", "html": return "paintbrush"
        case "png", "jpg", "jpeg", "gif", "svg", "webp", "heic", "icns": return "photo"
        case "sql", "sqlite": return "cylinder"
        case "test": return "checkmark.seal"
        default: return "doc"
        }
    }
}

/// A rounded square holding an SF Symbol, the anchor of every list row and step.
struct IconTile: View {
    let symbol: String
    var tint: Color = .textMuted
    var size: CGFloat = 24
    var background: Color = .subtle
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    var body: some View {
        let side = size * min(scale, 1.8)
        Image(systemName: symbol)
            .font(.system(size: side * 0.52, weight: .medium))
            .foregroundStyle(tint)
            .frame(width: side, height: side)
            .background(background, in: .rect(cornerRadius: side * 0.28, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// A project's own icon when the computer sent one, otherwise a monogram tile.
struct ProjectIcon: View {
    let name: String
    let dataURL: String?
    var size: CGFloat = 16
    @ScaledMetric(relativeTo: .footnote) private var scale: CGFloat = 1

    var body: some View {
        let size = self.size * min(scale, 1.8)
        Group {
            if let image = ProjectIconCache.image(for: dataURL) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
                    .font(.system(size: size * 0.6, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.subtleStrong)
            }
        }
        .frame(width: size, height: size)
        .clipShape(.rect(cornerRadius: size * 0.25, style: .continuous))
        .accessibilityHidden(true)
    }
}

enum ProjectIconCache {
    nonisolated(unsafe) private static let cache = NSCache<NSString, UIImage>()

    static func image(for dataURL: String?) -> UIImage? {
        guard let dataURL, dataURL.hasPrefix("data:image/"), let comma = dataURL.firstIndex(of: ",") else { return nil }
        let key = NSString(string: String(dataURL.suffix(64)) + "\(dataURL.count)")
        if let cached = cache.object(forKey: key) { return cached }
        guard dataURL[..<comma].hasSuffix(";base64"),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
              let image = UIImage(data: data) else { return nil }
        cache.setObject(image, forKey: key)
        return image
    }
}

/// Text with a light sweeping across it while something is in progress.
/// The overlay is always present and only its opacity follows `active`, so
/// a step finishing keeps the same view (and its text selection) instead of
/// being swapped for a different one.
struct Shimmer: ViewModifier {
    let active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = -1

    func body(content: Content) -> some View {
        content
            .overlay {
                GeometryReader { proxy in
                    LinearGradient(colors: [.clear, Color.screen.opacity(0.85), .clear], startPoint: .leading, endPoint: .trailing)
                        .frame(width: proxy.size.width * 0.5)
                        .offset(x: phase * proxy.size.width * 1.5)
                }
                .mask(content)
                .opacity(active && !reduceMotion ? 1 : 0)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
            .onAppear {
                withAnimation(.linear(duration: 1.6).repeatForever(autoreverses: false)) { phase = 1 }
            }
    }
}

extension View {
    func shimmering(_ active: Bool = true) -> some View {
        modifier(Shimmer(active: active))
    }
}

/// A calendar day in the device's time zone, as "yyyy-MM-dd".
enum DateKey {
    static func date(_ key: String) -> Date? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}

extension String {
    /// The local calendar day of an ISO timestamp.
    var dayKey: String? {
        guard let date = Timestamp.date(self) else { return nil }
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        guard let y = c.year, let m = c.month, let d = c.day else { return nil }
        return String(format: "%04d-%02d-%02d", y, m, d)
    }

    /// "14:02" today, "Mon 14:02" this week, otherwise the date and time.
    var messageTime: String {
        guard let date = Timestamp.date(self) else { return "" }
        if Calendar.current.isDateInToday(date) { return date.formatted(date: .omitted, time: .shortened) }
        return date.formatted(.dateTime.day().month(.abbreviated).hour().minute())
    }

    /// "5m"-style text for an ISO timestamp.
    var relativeTime: String {
        guard let date = Timestamp.date(self) else { return "" }
        let seconds = Date.now.timeIntervalSince(date)
        if seconds < 60 { return String(localized: "now") }
        if seconds < 3600 { return String(localized: "\(Int(seconds / 60))m") }
        if seconds < 86_400 { return String(localized: "\(Int(seconds / 3600))h") }
        if seconds < 7 * 86_400 { return String(localized: "\(Int(seconds / 86_400))d") }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }
}

enum Haptics {
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func selection() { UISelectionFeedbackGenerator().selectionChanged() }
}

/// The main action on a screen: a full-width graphite capsule, never white.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Color.primaryText)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(Color.primaryFill.opacity(isEnabled ? 1 : 0.4), in: .capsule)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

/// The primary action on the graphite welcome screen: a raised graphite capsule with a hairline.
struct BrandButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Color.brandText)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(Color.white.opacity(configuration.isPressed ? 0.16 : 0.11), in: .capsule)
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.14), lineWidth: 1))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

/// Appearance choices, named as on the desktop's Appearance settings.
enum AppTheme: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var title: LocalizedStringResource {
        switch self { case .system: "System"; case .light: "Light"; case .dark: "Dark" }
    }
    var scheme: ColorScheme? {
        switch self { case .system: nil; case .light: .light; case .dark: .dark }
    }
}

enum ReadingTypeface: String, CaseIterable, Identifiable {
    case serif, system, rounded
    var id: String { rawValue }
    var title: LocalizedStringResource {
        switch self { case .serif: "Serif"; case .system: "System"; case .rounded: "Rounded" }
    }
    var design: Font.Design {
        switch self { case .serif: .serif; case .system: .default; case .rounded: .rounded }
    }

    /// Reads the choice, keeping what an earlier version stored as a yes/no.
    static func stored(_ value: String?) -> ReadingTypeface {
        if let value, let typeface = ReadingTypeface(rawValue: value) { return typeface }
        return UserDefaults.standard.object(forKey: "display.serif") as? Bool == false ? .system : .serif
    }
}

/// The typeface for agent prose: serif by default, as chosen in Settings.
struct ReadingFont: ViewModifier {
    @AppStorage("display.typeface") private var typeface: String?
    func body(content: Content) -> some View {
        content.fontDesign(ReadingTypeface.stored(typeface).design)
    }
}

/// Applies Settings → Display → Theme to a window.
struct ThemeOverride: ViewModifier {
    @AppStorage("display.theme") private var theme = AppTheme.system.rawValue
    func body(content: Content) -> some View {
        content.preferredColorScheme(AppTheme(rawValue: theme)?.scheme)
    }
}

/// Code with syntax colour, cached: transcripts redraw often and parsing is the slow part.
enum Highlighted {
    private static let cache: NSCache<NSString, Box> = {
        let cache = NSCache<NSString, Box>()
        cache.countLimit = 300
        return cache
    }()
    private final class Box { let value: AttributedString; init(_ value: AttributedString) { self.value = value } }

    static func code(_ code: String, language: SyntaxHighlighter.Language?, key: String) -> AttributedString {
        guard let language else { return AttributedString(code) }
        let cacheKey = "\(key)\u{0}\(code)" as NSString
        if let hit = cache.object(forKey: cacheKey) { return hit.value }
        var text = AttributedString(code)
        let utf16 = code.utf16
        for span in SyntaxHighlighter.spans(code, language) {
            guard let lower = utf16.index(utf16.startIndex, offsetBy: span.range.lowerBound, limitedBy: utf16.endIndex),
                  let upper = utf16.index(utf16.startIndex, offsetBy: span.range.upperBound, limitedBy: utf16.endIndex),
                  let start = AttributedString.Index(lower, within: text),
                  let end = AttributedString.Index(upper, within: text) else { continue }
            text[start..<end].foregroundColor = switch span.kind {
            case .keyword: Color("SyntaxKeyword")
            case .string: Color("SyntaxString")
            case .comment: Color("SyntaxComment")
            case .number: Color("SyntaxNumber")
            }
        }
        cache.setObject(Box(text), forKey: cacheKey)
        return text
    }
}
