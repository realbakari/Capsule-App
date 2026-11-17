import Foundation

/// How a file changed, from whichever source described it.
nonisolated enum ChangeStatus: Equatable, Sendable {
    case added, modified, deleted, renamed, untracked

    /// A turn's file list: "added", "deleted" or "modified".
    init(turn status: String?) {
        switch status {
        case "added": self = .added
        case "deleted": self = .deleted
        case "renamed": self = .renamed
        default: self = .modified
        }
    }

    /// `git status --porcelain` codes, either column.
    init(git code: String) {
        let code = code.trimmingCharacters(in: .whitespaces)
        if code == "??" { self = .untracked; return }
        switch code.first {
        case "A": self = .added
        case "D": self = .deleted
        case "R", "C": self = .renamed
        default: self = .modified
        }
    }

    /// The one letter source control shows for it.
    var letter: String {
        switch self {
        case .added: "A"
        case .modified: "M"
        case .deleted: "D"
        case .renamed: "R"
        case .untracked: "U"
        }
    }

    var spoken: String {
        switch self {
        case .added: String(localized: "added")
        case .modified: String(localized: "modified")
        case .deleted: String(localized: "deleted")
        case .renamed: String(localized: "renamed")
        case .untracked: String(localized: "untracked")
        }
    }
}

/// Files of one folder, named relative to the folder every file in the list shares.
nonisolated struct FolderGroup<File>: Identifiable {
    /// Relative to `FolderGrouping.common`; empty for files directly in it.
    let folder: String
    let files: [File]
    var id: String { folder }
}

nonisolated struct FolderGrouping<File> {
    /// The deepest folder that holds every file, or empty.
    let common: String
    let groups: [FolderGroup<File>]

    /*
     * Groups by folder, top level first, then folders and file names in
     * Finder order. The shared leading folders come off every group so a
     * header names only what tells the groups apart.
     */
    init(_ files: [File], path: (File) -> String) {
        let folders = files.map { (path($0) as NSString).deletingLastPathComponent }
        var shared = folders.first.map { $0.split(separator: "/", omittingEmptySubsequences: true).map(String.init) } ?? []
        for folder in folders.dropFirst() {
            let parts = folder.split(separator: "/", omittingEmptySubsequences: true)
            var count = 0
            while count < shared.count, count < parts.count, shared[count] == parts[count] { count += 1 }
            shared.removeLast(shared.count - count)
        }
        common = shared.joined(separator: "/")
        let prefix = common.isEmpty ? 0 : shared.count
        var byFolder: [String: [File]] = [:]
        for (file, folder) in zip(files, folders) {
            let relative = folder.split(separator: "/", omittingEmptySubsequences: true).dropFirst(prefix).joined(separator: "/")
            byFolder[relative, default: []].append(file)
        }
        func name(_ file: File) -> String { (path(file) as NSString).lastPathComponent }
        groups = byFolder.keys
            .sorted { lhs, rhs in
                if lhs.isEmpty != rhs.isEmpty { return lhs.isEmpty }
                return lhs.localizedStandardCompare(rhs) == .orderedAscending
            }
            .map { folder in
                FolderGroup(folder: folder, files: byFolder[folder]!.sorted { name($0).localizedStandardCompare(name($1)) == .orderedAscending })
            }
    }

    /// Every file, in the order the groups show them.
    var files: [File] { groups.flatMap(\.files) }
}

/*
 * "Viewed" marks on a turn's changes. A mark belongs to one turn and one
 * version of a file's change there: a later turn that edits the file is a
 * different turn, and a changed count or status reads as a new version, so
 * the file shows as unviewed again. Only the newest turns are kept.
 */
nonisolated struct ViewedMarks: Codable, Equatable, Sendable {
    static let storageKey = "diff.viewed.v1"
    static let maxTurns = 40

    /// Turn → file version → when it was marked.
    private(set) var turns: [String: [String: Double]] = [:]

    static func key(_ file: TurnDiff.File) -> String {
        [file.path, file.status ?? "", file.added.map(String.init) ?? "", file.removed.map(String.init) ?? ""].joined(separator: "\u{0}")
    }

    func isViewed(_ file: TurnDiff.File, in run: String) -> Bool {
        turns[run]?[Self.key(file)] != nil
    }

    func unviewedCount(_ files: [TurnDiff.File], in run: String) -> Int {
        files.count { !isViewed($0, in: run) }
    }

    mutating func set(_ viewed: Bool, _ files: [TurnDiff.File], in run: String, now: Date = .now) {
        var marks = turns[run] ?? [:]
        for file in files {
            if viewed { marks[Self.key(file)] = now.timeIntervalSince1970 } else { marks[Self.key(file)] = nil }
        }
        turns[run] = marks.isEmpty ? nil : marks
        guard turns.count > Self.maxTurns else { return }
        let newest = turns.mapValues { $0.values.max() ?? 0 }.sorted { $0.value > $1.value }.prefix(Self.maxTurns).map(\.key)
        turns = turns.filter { newest.contains($0.key) }
    }

    static func load(_ defaults: UserDefaults = .standard) -> ViewedMarks {
        guard let data = defaults.data(forKey: storageKey) else { return ViewedMarks() }
        return (try? JSONDecoder().decode(ViewedMarks.self, from: data)) ?? ViewedMarks()
    }

    func save(_ defaults: UserDefaults = .standard) {
        defaults.set(try? JSONEncoder().encode(self), forKey: Self.storageKey)
    }
}

/*
 * A note left on diff lines, held per thread until it goes to the message box
 * with the others as one block. A draft, not a record: it lives as long as the
 * app does. `removed` says the line numbers count in the old file.
 */
nonisolated struct ReviewComment: Identifiable, Equatable, Sendable {
    var id = UUID()
    let path: String
    let lines: ClosedRange<Int>
    let removed: Bool
    var text: String

    var place: String {
        let range = lines.count == 1 ? "\(lines.lowerBound)" : "\(lines.lowerBound)–\(lines.upperBound)"
        return "\(path):\(range)" + (removed ? " (removed line)" : "")
    }

    /// "Review comments:" then one line per note in file and line order, as the computer writes it.
    static func block(_ comments: [ReviewComment]) -> String {
        let ordered = comments.sorted { ($0.path, $0.lines.lowerBound) < ($1.path, $1.lines.lowerBound) }
        let lines = ordered.map { comment in
            let parts = comment.text.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: "\n")
            return (["- \(comment.place) — \(parts.first ?? "")"] + parts.dropFirst().map { "  \($0)" }).joined(separator: "\n")
        }
        return (["Review comments:"] + lines).joined(separator: "\n")
    }
}
