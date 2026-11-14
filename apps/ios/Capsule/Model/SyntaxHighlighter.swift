import Foundation

/*
 * Light syntax colour for the languages agents write most. A single pass
 * marks comments, strings, numbers and keywords; anything it doesn't know
 * stays plain. It is deliberately not a parser: a wrong colour is worse than
 * none, so unknown languages and very long blocks are left alone.
 */
nonisolated enum SyntaxHighlighter {
    enum Kind: Equatable, Sendable { case keyword, string, comment, number }

    struct Span: Equatable, Sendable {
        let kind: Kind
        /// UTF-16 offsets.
        let range: Range<Int>
    }

    struct Language: Sendable {
        let keywords: Set<String>
        let lineComments: [String]
        let blockComment: (open: String, close: String)?
        let backtickStrings: Bool
    }

    static func language(_ name: String?) -> Language? {
        guard let name = name?.lowercased(), !name.isEmpty else { return nil }
        switch name {
        case "swift": return Language(keywords: swift, lineComments: ["//"], blockComment: ("/*", "*/"), backtickStrings: false)
        case "ts", "tsx", "typescript", "js", "jsx", "javascript", "mjs", "cjs":
            return Language(keywords: js, lineComments: ["//"], blockComment: ("/*", "*/"), backtickStrings: true)
        case "py", "python": return Language(keywords: python, lineComments: ["#"], blockComment: nil, backtickStrings: false)
        case "rs", "rust": return Language(keywords: rust, lineComments: ["//"], blockComment: ("/*", "*/"), backtickStrings: false)
        case "go", "golang": return Language(keywords: go, lineComments: ["//"], blockComment: ("/*", "*/"), backtickStrings: true)
        case "sh", "bash", "zsh", "shell", "console":
            return Language(keywords: shell, lineComments: ["#"], blockComment: nil, backtickStrings: true)
        case "json": return Language(keywords: ["true", "false", "null"], lineComments: [], blockComment: nil, backtickStrings: false)
        case "yaml", "yml", "toml": return Language(keywords: ["true", "false", "null", "yes", "no"], lineComments: ["#"], blockComment: nil, backtickStrings: false)
        case "c", "h", "cpp", "cc", "hpp", "m", "mm", "objc", "java", "kt", "kotlin", "cs", "csharp":
            return Language(keywords: cFamily, lineComments: ["//"], blockComment: ("/*", "*/"), backtickStrings: false)
        case "rb", "ruby": return Language(keywords: ruby, lineComments: ["#"], blockComment: nil, backtickStrings: false)
        case "sql": return Language(keywords: sql, lineComments: ["--"], blockComment: ("/*", "*/"), backtickStrings: false)
        case "css", "scss": return Language(keywords: [], lineComments: [], blockComment: ("/*", "*/"), backtickStrings: false)
        default: return nil
        }
    }

    /// The language for a file name, by extension.
    static func language(forPath path: String) -> Language? {
        language((path as NSString).pathExtension)
    }

    static func spans(_ code: String, _ language: Language) -> [Span] {
        let chars = Array(code.utf16)
        guard chars.count < 60_000 else { return [] }
        var spans: [Span] = []
        var i = 0
        func matches(_ token: String, at index: Int) -> Bool {
            let t = Array(token.utf16)
            guard index + t.count <= chars.count else { return false }
            return Array(chars[index..<index + t.count]) == t
        }
        func isIdentStart(_ c: UInt16) -> Bool { (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c == 95 || c == 36 }
        func isIdent(_ c: UInt16) -> Bool { isIdentStart(c) || (c >= 48 && c <= 57) }
        func isDigit(_ c: UInt16) -> Bool { c >= 48 && c <= 57 }

        while i < chars.count {
            let c = chars[i]
            if let marker = language.lineComments.first(where: { matches($0, at: i) }) {
                // `#` only starts a comment at the line's start or after a space (not `a#b`, not `#!/`'s path).
                if marker == "#", i > 0, chars[i - 1] != 10, chars[i - 1] != 32, chars[i - 1] != 9 { i += 1; continue }
                var end = i
                while end < chars.count, chars[end] != 10 { end += 1 }
                spans.append(Span(kind: .comment, range: i..<end)); i = end; continue
            }
            if let block = language.blockComment, matches(block.open, at: i) {
                var end = i + block.open.utf16.count
                while end < chars.count, !matches(block.close, at: end) { end += 1 }
                end = min(chars.count, end + block.close.utf16.count)
                spans.append(Span(kind: .comment, range: i..<end)); i = end; continue
            }
            if c == 34 || c == 39 || (c == 96 && language.backtickStrings) {
                var end = i + 1
                while end < chars.count {
                    let d = chars[end]
                    if d == 92 { end += 2; continue }     // backslash escape
                    if d == c { end += 1; break }
                    if d == 10, c != 96 { break }        // unterminated: stop at the line's end
                    end += 1
                }
                end = min(end, chars.count)
                spans.append(Span(kind: .string, range: i..<end)); i = end; continue
            }
            if isDigit(c), i == 0 || !isIdent(chars[i - 1]) {
                var end = i
                while end < chars.count, isIdent(chars[end]) || chars[end] == 46 { end += 1 }
                spans.append(Span(kind: .number, range: i..<end)); i = end; continue
            }
            if isIdentStart(c) {
                var end = i
                while end < chars.count, isIdent(chars[end]) { end += 1 }
                if language.keywords.contains(String(decoding: chars[i..<end], as: UTF16.self)) {
                    spans.append(Span(kind: .keyword, range: i..<end))
                }
                i = end; continue
            }
            i += 1
        }
        return spans
    }

    private static let swift: Set<String> = ["let", "var", "func", "struct", "class", "enum", "protocol", "extension", "if", "else", "guard", "return", "for", "in", "while", "switch", "case", "default", "import", "self", "Self", "init", "nil", "true", "false", "try", "await", "async", "throws", "throw", "do", "catch", "private", "public", "internal", "fileprivate", "static", "final", "override", "some", "any", "where", "break", "continue", "defer", "inout", "is", "as", "nonisolated", "actor", "typealias", "associatedtype", "mutating", "lazy", "weak", "unowned"]
    private static let js: Set<String> = ["const", "let", "var", "function", "return", "if", "else", "for", "while", "of", "in", "import", "export", "from", "default", "class", "extends", "new", "this", "async", "await", "try", "catch", "finally", "throw", "null", "undefined", "true", "false", "typeof", "instanceof", "interface", "type", "enum", "implements", "public", "private", "protected", "readonly", "switch", "case", "break", "continue", "as", "void", "yield"]
    private static let python: Set<String> = ["def", "class", "return", "if", "elif", "else", "for", "while", "in", "import", "from", "as", "with", "try", "except", "finally", "raise", "pass", "None", "True", "False", "and", "or", "not", "is", "lambda", "yield", "async", "await", "self", "global", "nonlocal", "break", "continue"]
    private static let rust: Set<String> = ["fn", "let", "mut", "pub", "struct", "enum", "impl", "trait", "use", "mod", "match", "if", "else", "for", "while", "loop", "in", "return", "self", "Self", "true", "false", "async", "await", "move", "ref", "where", "const", "static", "crate", "super", "as", "dyn", "unsafe", "break", "continue"]
    private static let go: Set<String> = ["func", "var", "const", "type", "struct", "interface", "package", "import", "return", "if", "else", "for", "range", "switch", "case", "default", "go", "defer", "chan", "map", "nil", "true", "false", "break", "continue", "select"]
    private static let shell: Set<String> = ["if", "then", "else", "elif", "fi", "for", "in", "do", "done", "while", "case", "esac", "function", "return", "export", "local", "echo", "cd", "sudo"]
    private static let cFamily: Set<String> = ["int", "char", "void", "float", "double", "long", "short", "unsigned", "signed", "const", "static", "struct", "enum", "union", "typedef", "return", "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "class", "public", "private", "protected", "new", "this", "null", "true", "false", "import", "package", "fun", "val", "var", "override", "namespace", "using", "include", "define", "bool", "auto", "nullptr", "virtual", "template", "final"]
    private static let ruby: Set<String> = ["def", "end", "class", "module", "if", "elsif", "else", "unless", "while", "do", "return", "yield", "self", "nil", "true", "false", "require", "attr_reader", "attr_accessor", "begin", "rescue", "ensure", "case", "when", "then"]
    private static let sql: Set<String> = ["select", "from", "where", "insert", "into", "values", "update", "set", "delete", "create", "table", "index", "join", "left", "right", "inner", "outer", "on", "and", "or", "not", "null", "as", "order", "by", "group", "limit", "having", "primary", "key", "references", "SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "INDEX", "JOIN", "LEFT", "INNER", "ON", "AND", "OR", "NOT", "NULL", "AS", "ORDER", "BY", "GROUP", "LIMIT", "PRIMARY", "KEY"]
}
