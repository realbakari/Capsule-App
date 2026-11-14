import Foundation

/*
 * "While you were away": what happened since you last had the app open, in
 * one place, so coming back is reading a summary rather than opening every
 * thread. Each line is a turn that finished, failed or stopped, or one that
 * is waiting on you, with the first line of what the agent said.
 */
nonisolated struct Brief: Equatable, Sendable {
    nonisolated struct Item: Identifiable, Equatable, Sendable {
        enum Outcome: Equatable, Sendable { case needsYou, finished, failed, stopped }
        let threadID: String
        let title: String
        let outcome: Outcome
        /// The agent's reply, first sentence, or the approval it's waiting on.
        let line: String?
        let at: Date
        var id: String { threadID }
    }

    let since: Date
    let items: [Item]

    var needsYou: Int { items.filter { $0.outcome == .needsYou }.count }
    var finished: Int { items.filter { $0.outcome == .finished }.count }
    var failed: Int { items.filter { $0.outcome == .failed }.count }

    /// The first sentence of a reply, without Markdown, short enough for one line.
    static func headline(_ markdown: String) -> String? {
        // The first line of prose: not a heading, a table row, or code inside a fence.
        var inFence = false
        var firstBlock: String?
        for raw in markdown.components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("```") { inFence.toggle(); continue }
            if inFence || line.isEmpty || line.hasPrefix("#") || line.hasPrefix("|") { continue }
            firstBlock = line
            break
        }
        guard var text = firstBlock else { return nil }
        while let first = text.first, "#>-*• ".contains(first) { text.removeFirst() }
        for marker in ["**", "__", "`"] { text = text.replacingOccurrences(of: marker, with: "") }
        // The sentence that says what happened: skip openers like "Done." or "Sure!".
        var sentences = text.components(separatedBy: ". ").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        while sentences.count > 1, sentences[0].split(separator: " ").count <= 2 { sentences.removeFirst() }
        text = sentences.first ?? text
        if sentences.count > 1, !text.hasSuffix(".") { text += "." }
        text = text.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return nil }
        return text.count > 120 ? String(text.prefix(117)) + "…" : text
    }
}

extension Workspace {
    private static let awayKey = "brief.since"

    /// When the app last went to the background; the brief covers what happened after.
    var awaySince: Date? {
        get { UserDefaults.standard.object(forKey: Self.awayKey) as? Date }
        set { UserDefaults.standard.set(newValue, forKey: Self.awayKey) }
    }

    /// Called when the app leaves the screen. A brief still showing keeps its start.
    func noteAway() {
        if awaySince == nil || briefDismissed {
            awaySince = .now
            briefDismissed = false
        }
    }

    /// Read it: the next brief starts from now.
    func dismissBrief() {
        awaySince = nil
        briefDismissed = true
    }

    func brief(now: Date = .now) -> Brief? {
        guard let since = awaySince, !briefDismissed else { return nil }
        var items: [Brief.Item] = []
        let open = Dictionary(uniqueKeysWithValues: threads.filter { !$0.isArchived }.map { ($0.id, $0) })
        for (threadID, run) in latestRuns {
            guard let thread = open[threadID] else { continue }
            let title = thread.title.isEmpty ? String(localized: "Untitled thread") : thread.title
            if let approval = pendingApprovals.first(where: { $0.runId == run.id }) {
                let at = Timestamp.date(approval.createdAt) ?? now
                items.append(.init(threadID: threadID, title: title, outcome: .needsYou, line: approval.action, at: at))
                continue
            }
            guard !run.status.isLive, let at = Timestamp.date(run.completedAt ?? run.updatedAt), at > since else { continue }
            let outcome: Brief.Item.Outcome = switch run.status {
            case .completed: .finished
            case .cancelled: .stopped
            default: .failed
            }
            let reply = cachedReply(threadID: threadID, runID: run.id).flatMap(Brief.headline)
            let line = outcome == .failed ? (run.error.flatMap(Brief.headline) ?? reply) : reply
            items.append(.init(threadID: threadID, title: title, outcome: outcome, line: line, at: at))
        }
        guard !items.isEmpty else { return nil }
        // What needs you first, then newest.
        items.sort { ($0.outcome == .needsYou ? 0 : 1, -$0.at.timeIntervalSince1970) < ($1.outcome == .needsYou ? 0 : 1, -$1.at.timeIntervalSince1970) }
        return Brief(since: since, items: items)
    }
}
