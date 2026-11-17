import Foundation

/*
 * What a notification says, decided the way the computer decides it, so a
 * phone and its computer describe the same moment in the same words.
 *
 * The thread's name is the title: "Finished" alone doesn't say which of a
 * dozen threads it was. Stopping a turn yourself isn't news, so a stopped
 * turn has no notice at all.
 */
nonisolated struct Notice: Equatable, Sendable {
    enum Kind: String, Sendable {
        case finished, failed, usageLimit, needsApproval, question

        /// Lower is more urgent: a decision outranks a failure, which outranks a finish.
        var rank: Int {
            switch self {
            case .question, .needsApproval: 0
            case .failed, .usageLimit: 1
            case .finished: 2
            }
        }

        var verb: String {
            switch self {
            case .question: String(localized: "has a question")
            case .needsApproval: String(localized: "needs your approval")
            case .failed: String(localized: "failed")
            case .usageLimit: String(localized: "hit a usage limit")
            case .finished: String(localized: "finished")
            }
        }
    }

    var kind: Kind
    var threadID: String?
    var threadTitle: String
    /// The specifics: the question, what wants approving, why it failed, when a limit lifts.
    var detail: String?

    static let detailLimit = 140

    static func firstLine(_ text: String?) -> String? {
        guard let line = text?.split(separator: "\n").map({ $0.trimmingCharacters(in: .whitespaces) }).first(where: { !$0.isEmpty })
        else { return nil }
        return line.count > detailLimit ? String(line.prefix(detailLimit - 1)) + "…" : line
    }

    /// What a settled turn has to say, or nothing.
    static func run(_ run: Run, threadTitle: String, now: Date = .now) -> Notice? {
        switch run.status {
        case .completed:
            return Notice(kind: .finished, threadID: run.sessionId, threadTitle: threadTitle)
        case .failed:
            let limit = UsageLimit.detect(run.error, now: now)
            if limit.limited {
                return Notice(kind: .usageLimit, threadID: run.sessionId, threadTitle: threadTitle,
                              detail: limit.resetsAt.map { String(localized: "Resets at \(UsageLimit.formatReset($0, now: now))") })
            }
            return Notice(kind: .failed, threadID: run.sessionId, threadTitle: threadTitle, detail: firstLine(run.error))
        case .blocked:
            return Notice(kind: .failed, threadID: run.sessionId, threadTitle: threadTitle,
                          detail: firstLine(run.error) ?? String(localized: "A rule stopped it before it ran."))
        default:
            return nil
        }
    }

    /// A pending approval is a question when the agent asked one.
    static func approval(_ approval: Approval, threadID: String?, threadTitle: String) -> Notice {
        if let question = approval.questions.first?.question {
            return Notice(kind: .question, threadID: threadID, threadTitle: threadTitle, detail: firstLine(question))
        }
        let who = approval.agentName ?? String(localized: "The agent")
        let what = "\(who) \(String(localized: "wants to")) \(ApprovalWording.verbPhrase(approval.action)) \(approval.target)"
        return Notice(kind: .needsApproval, threadID: threadID, threadTitle: threadTitle,
                      detail: firstLine(what.trimmingCharacters(in: .whitespaces)))
    }

    /// "Has a question: Which database?"
    var body: String {
        let verb = kind.verb.prefix(1).uppercased() + kind.verb.dropFirst()
        return detail.map { "\(verb): \($0)" } ?? verb
    }

    /// One line per thread inside a burst: "“Fix login” failed".
    var summary: String { "\u{201C}\(threadTitle)\u{201D} \(kind.verb)" }

    /// A burst as one notification. Each thread keeps its latest notice; the
    /// most urgent thread is the one a tap opens.
    static func coalesce(_ notices: [Notice]) -> (title: String, body: String, threadID: String?)? {
        var order: [String] = []
        var latest: [String: Notice] = [:]
        for (index, notice) in notices.enumerated() {
            let key = notice.threadID ?? "notice:\(index)"
            order.removeAll { $0 == key }
            order.append(key)
            latest[key] = notice
        }
        let ordered = order.compactMap { latest[$0] }.enumerated()
            .sorted { ($0.element.kind.rank, $0.offset) < ($1.element.kind.rank, $1.offset) }.map(\.element)
        guard let first = ordered.first else { return nil }
        if ordered.count == 1 { return (first.threadTitle, first.body, first.threadID) }
        let needYou = ordered.filter { $0.kind.rank < 2 }.count
        let title = needYou == 1 ? String(localized: "1 thread needs you")
            : needYou > 1 ? String(localized: "\(needYou) threads need you")
            : String(localized: "\(ordered.count) threads finished")
        return (title, ordered.map(\.summary).joined(separator: " · "), first.threadID)
    }
}

/// "Run a command" reads as "wants to run a command"; "NPM install" keeps its capitals.
nonisolated enum ApprovalWording {
    static func verbPhrase(_ action: String) -> String {
        let chars = Array(action)
        guard chars.count > 1, chars[0].isUppercase, chars[1].isLowercase else { return action }
        return chars[0].lowercased() + String(chars.dropFirst())
    }
}

/*
 * A turn that stopped because the provider is out of allowance. The routes
 * don't carry structured limit windows, so this reads the words the agent
 * used and, when they name a time, when the limit lifts.
 */
nonisolated enum UsageLimit {
    struct Result: Equatable { var limited: Bool; var resetsAt: Date? }

    // "quota" alone also matches "Disk quota exceeded", which is not a provider limit.
    private static let limit = "rate limit|usage limit|session limit|(?<!disk )quota|too many requests|limit (?:reached|exceeded)|out of (?:credits|budget)"
    private static let units = "seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d"

    private static func unitSeconds(_ raw: String?) -> Double {
        switch (raw ?? "s").lowercased() {
        case let u where u.hasPrefix("d"): 86_400
        case let u where u.hasPrefix("h"): 3_600
        case let u where u.hasPrefix("m"): 60
        default: 1
        }
    }

    private static func regex(_ pattern: String) -> NSRegularExpression? {
        try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
    }

    private static func group(_ match: NSTextCheckingResult, _ index: Int, in text: String) -> String? {
        guard index < match.numberOfRanges, let range = Range(match.range(at: index), in: text) else { return nil }
        return String(text[range])
    }

    private static func relative(_ text: String, now: Date) -> Date? {
        let full = NSRange(text.startIndex..., in: text)
        var amount: String?
        if let match = regex("(?:try again|retry|resets?|available|back)\\s+(?:again\\s+)?(?:in|after)\\s+((?:\\d+\\s*(?:\(units))\\b\\s*(?:and\\s+)?)+)")?
            .firstMatch(in: text, range: full) {
            amount = group(match, 1, in: text)
        } else if let match = regex("retry-after:?\\s*(\\d+)\\s*(?:s|seconds?)?")?.firstMatch(in: text, range: full) {
            amount = group(match, 1, in: text)
        }
        guard let amount, let parts = regex("(\\d+)\\s*(\(units))?\\b") else { return nil }
        let total = parts.matches(in: amount, range: NSRange(amount.startIndex..., in: amount)).reduce(0.0) { sum, part in
            sum + (Double(group(part, 1, in: amount) ?? "") ?? 0) * unitSeconds(group(part, 2, in: amount))
        }
        return total > 0 ? now.addingTimeInterval(total) : nil
    }

    private static func absolute(_ text: String, now: Date) -> Date? {
        let full = NSRange(text.startIndex..., in: text)
        if let match = regex("(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2})?(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?)")?.firstMatch(in: text, range: full),
           let stamp = group(match, 1, in: text), let date = Timestamp.date(stamp), date > now {
            return date
        }
        // Whole words only: "chat 4 times" is not a clock time.
        guard let clock = regex("\\b(?:resets?|available|back|until|at)\\s+(?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?\\b(\\s*(?:UTC|GMT|Z)\\b)?")?
            .firstMatch(in: text, range: full), var hours = Int(group(clock, 1, in: text) ?? "") else { return nil }
        let minutes = Int(group(clock, 2, in: text) ?? "0") ?? 0
        let meridiem = group(clock, 3, in: text)?.lowercased()
        if meridiem == "pm" && hours < 12 { hours += 12 }
        if meridiem == "am" && hours == 12 { hours = 0 }
        guard hours <= 23, minutes <= 59 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        // A time named in UTC is not the person's local clock.
        calendar.timeZone = group(clock, 4, in: text) != nil ? TimeZone(identifier: "UTC")! : .current
        guard var date = calendar.date(bySettingHour: hours, minute: minutes, second: 0, of: now) else { return nil }
        // A clock time already behind us means tomorrow.
        if date <= now { date = calendar.date(byAdding: .day, value: 1, to: date) ?? date }
        return date
    }

    static func detect(_ error: String?, now: Date = .now) -> Result {
        let text = (error ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, regex(limit)?.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil else { return Result(limited: false) }
        return Result(limited: true, resetsAt: relative(text, now: now) ?? absolute(text, now: now))
    }

    static func formatReset(_ at: Date, now: Date = .now) -> String {
        let time = at.formatted(date: .omitted, time: .shortened)
        return Calendar.current.isDate(at, inSameDayAs: now) ? time : "\(at.formatted(.dateTime.weekday(.abbreviated))) \(time)"
    }
}
