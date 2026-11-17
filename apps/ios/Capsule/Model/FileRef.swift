import Foundation

/*
 * When a code span in a reply names a file. A path needs a separator and a
 * last segment that is a file name; a bare name needs a well-known
 * extension. A slash alone says nothing: branch names (fix/login), folders
 * (tmp/) and owner/repo pairs carry one. Same rules as the computer, so a
 * span is a file on both or on neither.
 */
nonisolated struct FileRef: Equatable, Sendable {
    var path: String
    var line: Int?
    var name: String

    static let scheme = "capsule-file"

    nonisolated(unsafe) private static let knownExtension = #/(?i)\.(ts|tsx|js|jsx|json|css|scss|html|md|mdx|py|rs|go|rb|java|kt|swift|c|h|cc|cpp|cs|php|yml|yaml|toml|sh|mjs|cjs|sql|svg|txt|lock)$/#
    nonisolated(unsafe) private static let anyExtension = #/\.[A-Za-z0-9_-]{1,10}$/#
    private static let knownNames: Set<String> = ["Makefile", "Dockerfile", "Gemfile", "Procfile", "LICENSE", "README"]
    /// A first segment that is a host ("docs.rs/…") makes it a URL, not a path.
    nonisolated(unsafe) private static let host = #/(?i)^[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|org|net|io|dev|rs|app|ai|co|sh|so|xyz|me)$/#
    /// Product names spelled like files ("Node.js") are prose.
    nonisolated(unsafe) private static let product = #/^[A-Z][a-z]+\.js$/#
    /// A version ("v1.2", "1.2.3") is not a file name.
    nonisolated(unsafe) private static let version = #/(?i)^v?\d+(\.\d+)+$/#
    nonisolated(unsafe) private static let scheme_ = #/(?i)^[a-z][a-z0-9+.-]*:\/\//#
    nonisolated(unsafe) private static let location = #/^(.*?)(?::(\d+)(?::\d+)?)?$/#

    static func read(_ value: String) -> FileRef? {
        guard (3...160).contains(value.count), !value.contains(where: \.isWhitespace),
              !value.hasPrefix("-"), value.firstMatch(of: scheme_) == nil, !value.contains("…"),
              let match = value.wholeMatch(of: location) else { return nil }
        let path = String(match.1)
        let line = match.2.flatMap { Int($0) }
        guard !path.hasSuffix("/"), !path.hasSuffix("\\") else { return nil }
        let segments = path.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "/" || $0 == "\\" }).map(String.init)
        guard let name = segments.last, !name.isEmpty, name.wholeMatch(of: version) == nil else { return nil }
        if segments.count > 1 {
            if segments[0].wholeMatch(of: host) != nil { return nil }
            return name.firstMatch(of: anyExtension) != nil || knownNames.contains(name) ? FileRef(path: path, line: line, name: name) : nil
        }
        if name.wholeMatch(of: product) != nil { return nil }
        return name.firstMatch(of: knownExtension) != nil || (line != nil && name.firstMatch(of: anyExtension) != nil)
            ? FileRef(path: path, line: line, name: name) : nil
    }

    /// A path the project can serve, relative to its folder, or nil when it lies outside.
    /// Relative paths pass through; an absolute one must sit under `root`.
    static func inProject(_ path: String, root: String?) -> String? {
        let absolute = path.hasPrefix("/") || path.hasPrefix("~") || path.firstMatch(of: #/^[A-Za-z]:[\\/]/#) != nil
        guard absolute else { return path }
        guard let root, !root.isEmpty else { return nil }
        let base = root.hasSuffix("/") ? String(root.dropLast()) : root
        guard path.lowercased().hasPrefix(base.lowercased() + "/") else { return nil }
        return String(path.dropFirst(base.count + 1))
    }

    /// The link a code span carries, so tapping it opens the file.
    var url: URL? {
        var components = URLComponents()
        components.scheme = Self.scheme
        components.host = "open"
        components.queryItems = [URLQueryItem(name: "path", value: path)] + (line.map { [URLQueryItem(name: "line", value: String($0))] } ?? [])
        return components.url
    }

    init(path: String, line: Int?, name: String) {
        self.path = path; self.line = line; self.name = name
    }

    init?(url: URL) {
        guard url.scheme == Self.scheme, let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let path = items.first(where: { $0.name == "path" })?.value else { return nil }
        self.init(path: path, line: items.first { $0.name == "line" }?.value.flatMap(Int.init),
                  name: (path as NSString).lastPathComponent)
    }
}
