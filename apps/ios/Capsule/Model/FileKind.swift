import Foundation

/*
 * What kind of file a name is, for the glyph beside it in file lists. One
 * table answers every list: `mark` is an SF Symbol or one or two letters, and
 * `tone` names a theme colour so each kind follows the light and dark palettes.
 * Mirrors the desktop's file-kind table so a file reads the same on both.
 */
nonisolated struct FileKind: Equatable, Sendable {
    enum Mark: Equatable, Sendable {
        case symbol(String)
        case letters(String)
    }

    enum Tone: Equatable, Sendable { case keyword, string, number, attention, success, failure, muted }

    let mark: Mark
    let tone: Tone

    /// A symbol for places that can only hold one, such as a `Label`.
    var symbol: String {
        switch mark {
        case .symbol(let name): name
        case .letters: "chevron.left.forwardslash.chevron.right"
        }
    }

    static func of(_ path: String) -> FileKind {
        let original = (path as NSString).lastPathComponent
        let name = original.lowercased()
        if let kind = byName[name] { return kind }
        if isTest(original) { return FileKind(mark: .symbol("testtube.2"), tone: .success) }
        let ext = (name as NSString).pathExtension
        if let kind = byExtension[ext] { return kind }
        if name.hasPrefix(".") { return config }
        return FileKind(mark: .symbol("doc"), tone: .muted)
    }

    /// `thing.test.ts`, `thing_spec.rb`, `ThingTests.swift`, `test_thing.py`, `thing_test.go`.
    /// Camel-case `Test` needs its capital, so `latest.ts` stays a TypeScript file.
    static func isTest(_ fileName: String) -> Bool {
        let stem = (fileName as NSString).deletingPathExtension
        let lower = stem.lowercased()
        let separated = [".test", ".spec", "_test", "_spec", "-test", "-spec"].contains { lower.hasSuffix($0) } || lower.hasPrefix("test_")
        let camel = (stem.hasSuffix("Tests") || stem.hasSuffix("Test")) && stem.count > 5
        return separated || camel
    }

    private static func letters(_ text: String, _ tone: Tone) -> FileKind { FileKind(mark: .letters(text), tone: tone) }
    private static func symbol(_ name: String, _ tone: Tone) -> FileKind { FileKind(mark: .symbol(name), tone: tone) }

    private static let typescript = letters("TS", .number)
    private static let javascript = letters("JS", .attention)
    private static let json = symbol("curlybraces", .number)
    private static let markdown = symbol("text.alignleft", .string)
    private static let css = symbol("paintbrush.pointed", .keyword)
    private static let shell = symbol("apple.terminal", .string)
    private static let config = symbol("slider.horizontal.3", .muted)
    private static let image = symbol("photo", .string)
    private static let lock = symbol("lock", .muted)
    private static let package = symbol("shippingbox", .failure)
    private static let git = symbol("arrow.triangle.branch", .failure)
    private static let database = symbol("cylinder", .keyword)

    private static let byExtension: [String: FileKind] = [
        "swift": symbol("swift", .keyword),
        "ts": typescript, "mts": typescript, "cts": typescript, "tsx": typescript,
        "js": javascript, "mjs": javascript, "cjs": javascript, "jsx": javascript,
        "json": json, "jsonc": json, "json5": json,
        "md": markdown, "mdx": markdown, "markdown": markdown,
        "css": css, "scss": css, "sass": css, "less": css,
        "html": symbol("chevron.left.forwardslash.chevron.right", .number),
        "htm": symbol("chevron.left.forwardslash.chevron.right", .number),
        "py": letters("PY", .number), "rs": letters("RS", .keyword), "go": letters("GO", .number),
        "rb": letters("RB", .failure), "kt": letters("KT", .keyword), "java": letters("JV", .keyword),
        "c": letters("C", .number), "h": letters("H", .number), "m": letters("M", .number),
        "cpp": letters("C+", .number), "hpp": letters("H+", .number), "cs": letters("C#", .keyword),
        "php": letters("PH", .keyword), "lua": letters("LU", .number), "zig": letters("ZG", .attention),
        "vue": letters("VU", .string), "svelte": letters("SV", .keyword),
        "sh": shell, "zsh": shell, "bash": shell, "fish": shell,
        "yml": config, "yaml": config, "toml": config, "ini": config, "plist": config, "xcprivacy": config,
        "entitlements": config, "env": config, "xcstrings": symbol("globe", .number),
        "sql": database, "sqlite": database, "db": database,
        "png": image, "jpg": image, "jpeg": image, "gif": image, "webp": image, "heic": image, "ico": image,
        "icns": image, "avif": image, "svg": symbol("square.on.circle", .number),
        "pdf": symbol("doc.richtext", .failure),
        "lock": lock,
        "txt": symbol("doc.plaintext", .muted), "log": symbol("doc.plaintext", .muted),
        "csv": symbol("tablecells", .string), "tsv": symbol("tablecells", .string),
    ]

    /// Whole-name matches win over the extension: a lockfile is not YAML.
    private static let byName: [String: FileKind] = [
        "package.json": package, "package-lock.json": lock, "pnpm-lock.yaml": lock, "yarn.lock": lock,
        "cargo.lock": lock, "bun.lock": lock, "pnpm-workspace.yaml": package, "cargo.toml": package,
        "package.swift": package, "podfile": package, "gemfile": package,
        "tsconfig.json": typescript,
        "dockerfile": symbol("shippingbox", .number), "makefile": symbol("hammer", .number),
        ".gitignore": git, ".gitattributes": git, ".gitmodules": git, ".gitkeep": git,
        "agents.md": symbol("text.bubble", .number), "claude.md": symbol("text.bubble", .number),
        "license": symbol("checkmark.seal", .muted), "license.md": symbol("checkmark.seal", .muted),
    ]
}
