import Foundation

/// A unified git patch, split per file into lines the diff view can colour.
nonisolated struct UnifiedDiff: Equatable, Sendable {
    nonisolated struct Line: Identifiable, Equatable, Sendable {
        enum Kind: Equatable, Sendable { case context, added, removed, hunk, meta }
        let id: Int
        let kind: Kind
        let text: String
        let oldNumber: Int?
        let newNumber: Int?
        /// Character ranges (UTF-16 offsets) that differ from the paired line, for word highlighting.
        var changed: [Range<Int>] = []
    }

    nonisolated struct FilePatch: Identifiable, Equatable, Sendable {
        var path: String
        var lines: [Line]
        var added: Int
        var removed: Int
        var isBinary: Bool
        var id: String { path }
    }

    var files: [FilePatch]

    static func parse(_ patch: String) -> UnifiedDiff {
        var files: [FilePatch] = []
        var current: FilePatch?
        var oldLine = 0, newLine = 0, counter = 0

        func finish() { if let current { files.append(current) } }

        for raw in patch.components(separatedBy: "\n") {
            if raw.hasPrefix("diff --git ") {
                finish()
                let path = raw.components(separatedBy: " b/").last ?? raw
                current = FilePatch(path: path, lines: [], added: 0, removed: 0, isBinary: false)
                continue
            }
            guard current != nil else { continue }
            counter += 1
            if raw.hasPrefix("+++ ") {
                let target = String(raw.dropFirst(4))
                if target != "/dev/null" { current?.path = target.hasPrefix("b/") ? String(target.dropFirst(2)) : target }
                continue
            }
            if raw.hasPrefix("--- ") || raw.hasPrefix("index ") || raw.hasPrefix("similarity ") { continue }
            if raw.hasPrefix("new file") || raw.hasPrefix("deleted file") || raw.hasPrefix("rename ") || raw.hasPrefix("old mode") || raw.hasPrefix("new mode") {
                current?.lines.append(Line(id: counter, kind: .meta, text: raw, oldNumber: nil, newNumber: nil))
                continue
            }
            if raw.hasPrefix("Binary files") {
                current?.isBinary = true
                continue
            }
            if raw.hasPrefix("@@") {
                let numbers = Self.hunkStarts(raw)
                oldLine = numbers.old
                newLine = numbers.new
                current?.lines.append(Line(id: counter, kind: .hunk, text: raw, oldNumber: nil, newNumber: nil))
                continue
            }
            if raw.hasPrefix("+") {
                current?.lines.append(Line(id: counter, kind: .added, text: String(raw.dropFirst()), oldNumber: nil, newNumber: newLine))
                current?.added += 1
                newLine += 1
            } else if raw.hasPrefix("-") {
                current?.lines.append(Line(id: counter, kind: .removed, text: String(raw.dropFirst()), oldNumber: oldLine, newNumber: nil))
                current?.removed += 1
                oldLine += 1
            } else if raw.hasPrefix(" ") {
                current?.lines.append(Line(id: counter, kind: .context, text: String(raw.dropFirst()), oldNumber: oldLine, newNumber: newLine))
                oldLine += 1
                newLine += 1
            } else if raw.hasPrefix("\\") {
                current?.lines.append(Line(id: counter, kind: .meta, text: raw, oldNumber: nil, newNumber: nil))
            }
        }
        finish()
        return UnifiedDiff(files: files.map { file in
            var file = file
            file.lines = markWordChanges(file.lines)
            return file
        })
    }

    /*
     * Pairs each run of removed lines with the run of added lines after it,
     * line by line, and marks the words that differ. Lines too different to
     * compare usefully (or too long) are left plain: a fully highlighted line
     * says nothing the colour of the line doesn't already.
     */
    static func markWordChanges(_ lines: [Line]) -> [Line] {
        var lines = lines
        var index = 0
        while index < lines.count {
            guard lines[index].kind == .removed else { index += 1; continue }
            let removedStart = index
            while index < lines.count, lines[index].kind == .removed { index += 1 }
            let addedStart = index
            while index < lines.count, lines[index].kind == .added { index += 1 }
            // Pair each removed line with the next added line that is mostly the
            // same, keeping order. Position alone pairs unrelated lines when a
            // change inserts or drops lines in the middle.
            var nextAdded = addedStart
            for old in removedStart..<addedStart {
                guard let new = (nextAdded..<index).first(where: { similar(lines[old].text, lines[$0].text) }) else { continue }
                nextAdded = new + 1
                guard let (oldRanges, newRanges) = wordDiff(lines[old].text, lines[new].text) else { continue }
                lines[old].changed = oldRanges
                lines[new].changed = newRanges
            }
        }
        return lines
    }

    /// Whether two lines share at least half their words.
    static func similar(_ old: String, _ new: String) -> Bool {
        let a = tokens(old).map(\.text).filter { !$0.allSatisfy(\.isWhitespace) }
        let b = tokens(new).map(\.text).filter { !$0.allSatisfy(\.isWhitespace) }
        guard !a.isEmpty, !b.isEmpty else { return false }
        let removed = b.difference(from: a).removals.count
        return (a.count - removed) * 2 >= max(a.count, b.count)
    }

    /// Changed ranges in each line, or nil when the lines share too little.
    static func wordDiff(_ old: String, _ new: String) -> ([Range<Int>], [Range<Int>])? {
        guard old.utf16.count < 600, new.utf16.count < 600 else { return nil }
        let a = tokens(old), b = tokens(new)
        let difference = b.map(\.text).difference(from: a.map(\.text))
        var removedIdx = Set<Int>(), insertedIdx = Set<Int>()
        for change in difference {
            switch change {
            case .remove(let offset, _, _): removedIdx.insert(offset)
            case .insert(let offset, _, _): insertedIdx.insert(offset)
            }
        }
        let unchanged = a.count - removedIdx.count
        guard unchanged * 2 >= max(a.count, b.count), !removedIdx.isEmpty || !insertedIdx.isEmpty else { return nil }
        func merge(_ toks: [Token], _ picked: Set<Int>) -> [Range<Int>] {
            var ranges: [Range<Int>] = []
            for i in picked.sorted() where !toks[i].text.allSatisfy(\.isWhitespace) {
                let r = toks[i].range
                if let last = ranges.last, last.upperBound >= r.lowerBound - 1 { ranges[ranges.count - 1] = last.lowerBound..<r.upperBound }
                else { ranges.append(r) }
            }
            return ranges
        }
        return (merge(a, removedIdx), merge(b, insertedIdx))
    }

    struct Token { let text: String; let range: Range<Int> }

    /// Words, runs of spaces, and single punctuation characters, with UTF-16 offsets.
    static func tokens(_ text: String) -> [Token] {
        var result: [Token] = []
        var current = "", start = 0, offset = 0, kind = 0
        func flush() { if !current.isEmpty { result.append(Token(text: current, range: start..<offset)) }; current = "" }
        for character in text {
            let k = character.isLetter || character.isNumber || character == "_" ? 1 : character.isWhitespace ? 2 : 3
            if k != kind || k == 3 { flush(); start = offset; kind = k }
            current.append(character)
            offset += character.utf16.count
        }
        flush()
        return result
    }

    /// `@@ -12,7 +12,9 @@` → (12, 12).
    static func hunkStarts(_ header: String) -> (old: Int, new: Int) {
        let parts = header.split(separator: " ")
        func start(_ prefix: Character) -> Int {
            guard let token = parts.first(where: { $0.first == prefix }) else { return 0 }
            return Int(token.dropFirst().split(separator: ",").first ?? "") ?? 0
        }
        return (start("-"), start("+"))
    }
}
