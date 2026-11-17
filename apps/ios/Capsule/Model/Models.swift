import Foundation

/*
 * The desktop's records, as they arrive over the paired socket.
 *
 * Every field the app does not strictly need is optional: the desktop adds
 * fields release by release, and a phone that refused a thread because one
 * new key changed type would be worse than one that ignores it.
 */

nonisolated struct Project: Codable, Identifiable, Hashable, Sendable {
    let id: String
    var name: String
    var description: String?
    var workingDirectory: String?
    /// The project's own icon, as a data URL the computer resolved.
    var iconDataUrl: String?
    var updatedAt: String?
}

nonisolated struct ChatThread: Codable, Identifiable, Hashable, Sendable {
    let id: String
    var projectId: String
    var agentId: String?
    var title: String
    var state: String?
    var harnessId: String?
    /// The live agent session's id; `direct:` when Capsule runs the agent itself.
    var openclawSessionKey: String?
    /// "plan" or "act": how the computer sends the next message.
    var turnMode: String?
    var pinned: Bool?
    var pinOrder: Double?
    var createdAt: String
    var updatedAt: String

    var isArchived: Bool { state == "archived" }
    var isPlanning: Bool { turnMode == "plan" }
    /// The direct route asks again for each request, so it can't allow for a whole thread.
    var isDirect: Bool { openclawSessionKey?.hasPrefix("direct:") == true }
}

nonisolated struct ChatMessage: Codable, Identifiable, Hashable, Sendable {
    enum Role: String, Codable, Sendable { case user, assistant, system }
    let id: String
    var sessionId: String
    var role: Role
    var content: String
    var contentTruncated: Bool?
    var attachments: [MessageAttachment]?
    var kind: String?
    var runId: String?
    var createdAt: String
}

/// A file sent with a message. `path` is on the computer and never opened here.
nonisolated struct MessageAttachment: Codable, Hashable, Sendable {
    var name: String
    /// Where the computer stored it; the phone only ever echoes back paths it was given.
    var path: String?
    var size: Double?
    var mimeType: String?
    /// A small preview of an image, as a data URI, made by the computer.
    var thumbnail: String?

    var isImage: Bool { mimeType?.hasPrefix("image/") == true || thumbnail != nil }
}

nonisolated struct MessagePage: Codable, Sendable {
    var messages: [ChatMessage]
    var hasMore: Bool
}

nonisolated enum RunStatus: String, Codable, Sendable {
    case queued, running, waiting
    case approvalRequired = "approval_required"
    case completed, failed, cancelled, blocked

    /// Statuses the desktop will still change on its own.
    var isLive: Bool {
        switch self {
        case .queued, .running, .waiting, .approvalRequired: true
        default: false
        }
    }
}

nonisolated struct Run: Codable, Identifiable, Hashable, Sendable {
    let id: String
    var sessionId: String
    var projectId: String?
    var agentId: String?
    var status: RunStatus
    var prompt: String?
    var result: String?
    var error: String?
    var checkpointRef: String?
    var createdAt: String
    var updatedAt: String
    var completedAt: String?
}

nonisolated struct RunEvent: Codable, Identifiable, Hashable, Sendable {
    let id: String
    var runId: String
    var sessionId: String?
    var timestamp: String
    var type: String
    var message: String
    var data: JSONValue?
}

nonisolated struct RunEventPage: Codable, Sendable {
    nonisolated struct Cursor: Codable, Sendable, Equatable { var timestamp: String; var id: String }
    var events: [RunEvent]
    var hasMore: Bool?
    /// Where the next page back starts, when there is one.
    var before: Cursor?
}

nonisolated struct Approval: Codable, Identifiable, Hashable, Sendable {
    enum Status: String, Codable, Sendable {
        case pending
        case approvedOnce = "approved_once"
        case approvedSession = "approved_session"
        case denied, cancelled
    }
    let id: String
    var runId: String
    var agentId: String?
    var agentName: String?
    var action: String
    var target: String
    var reason: String
    var status: Status
    var details: JSONValue?
    var createdAt: String
    var resolvedAt: String?
}

extension Approval {
    /// The command or file the tool wants, when the agent said.
    nonisolated var subject: String? {
        if case .object(let input)? = details?["rawInput"], let command = input["command"]?.string { return command }
        if let title = details?["title"]?.string, !title.isEmpty { return title }
        return nil
    }

    /// Set when the agent stopped to ask rather than to be allowed something.
    nonisolated var questions: [AgentQuestion] {
        guard case .array(let list)? = details?["questions"] else { return [] }
        return list.compactMap(AgentQuestion.init(json:))
    }

    nonisolated var isQuestion: Bool { !questions.isEmpty }

    /// False when the agent offered no "allow once": the computer refuses it, so the phone doesn't offer it.
    nonisolated var canApproveOnce: Bool { details?["canApproveOnce"]?.bool != false }

    /// One line for a list or the Lock Screen: the question, or what it wants to do.
    nonisolated var headline: String { questions.first?.question ?? action }
}

/// A question an agent stopped to ask, with the choices it offered.
nonisolated struct AgentQuestion: Identifiable, Hashable, Sendable {
    nonisolated struct Option: Hashable, Sendable {
        var label: String
        var description: String?
    }
    /// Answers are keyed by it.
    var id: String
    var header: String?
    var question: String
    var options: [Option]
    var multiSelect: Bool
    /// Free text is accepted alongside, or instead of, the options.
    var allowOther: Bool
    /// Masked while typed; the computer keeps it out of the transcript.
    var secret: Bool

    init(id: String, header: String? = nil, question: String, options: [Option] = [], multiSelect: Bool = false,
         allowOther: Bool = true, secret: Bool = false) {
        self.id = id; self.header = header; self.question = question; self.options = options
        self.multiSelect = multiSelect; self.allowOther = allowOther; self.secret = secret
    }

    init?(json: JSONValue) {
        guard let id = json["id"]?.string, let question = json["question"]?.string, !question.isEmpty else { return nil }
        let options: [Option] = if case .array(let list)? = json["options"] {
            list.compactMap { item in item["label"]?.string.map { Option(label: $0, description: item["description"]?.string) } }
        } else { [] }
        self.init(id: id, header: json["header"]?.string, question: question, options: options,
                  multiSelect: json["multiSelect"]?.bool == true,
                  allowOther: json["allowOther"]?.bool ?? options.isEmpty, secret: json["secret"]?.bool == true)
    }
}

nonisolated struct TurnDiff: Codable, Sendable, Equatable {
    nonisolated struct File: Codable, Sendable, Hashable, Identifiable {
        var path: String
        var added: Int?
        var removed: Int?
        var status: String?
        var id: String { path }
    }
    var patch: String
    var files: [File]
    var patchTruncated: Bool?
    var filesTruncated: Bool?
    var available: Bool?
}

/// Any JSON value, for the open-ended `data` on events and approvals.
nonisolated enum JSONValue: Codable, Hashable, Sendable {
    case string(String), number(Double), bool(Bool), null
    case array([JSONValue]), object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }

    subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    var string: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    var bool: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }
}

/// ISO-8601 timestamps from the desktop, with or without fractional seconds.
nonisolated enum Timestamp {
    private static let fractional = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    private static let plain = Date.ISO8601FormatStyle()

    static func date(_ value: String) -> Date? {
        (try? fractional.parse(value)) ?? (try? plain.parse(value))
    }
}

// MARK: Project inspection (read-only on every pairing)

nonisolated struct FileEntry: Codable, Identifiable, Hashable, Sendable {
    var name: String
    var path: String
    var type: String
    var id: String { path }
    var isDirectory: Bool { type == "directory" }
}

nonisolated struct FilePreview: Codable, Sendable, Equatable {
    var path: String
    var kind: String
    var language: String?
    var contents: String?
    var dataUrl: String?
    var truncated: Bool
    var size: Double
    var detail: String?
}

nonisolated struct GitChange: Codable, Identifiable, Hashable, Sendable {
    var path: String
    var code: String
    var added: Int?
    var removed: Int?
    var id: String { path }
}

nonisolated struct GitStatus: Codable, Sendable, Equatable {
    var available: Bool
    var isRepo: Bool
    var branch: String?
    var dirty: Bool
    var changed: Int
    var summary: String
    var files: [GitChange]
    var branches: [String]
    var ahead: Int?
    var behind: Int?
    var added: Int?
    var removed: Int?
}

nonisolated struct GitPullRequest: Codable, Identifiable, Hashable, Sendable {
    var number: Int
    var url: String
    var title: String
    var isDraft: Bool
    var state: String
    var reviewDecision: String?
    var checks: String?
    var checksSummary: String?
    var author: String?
    var headRefName: String?
    var updatedAt: String?
    var id: Int { number }
}

nonisolated struct PullRequestList: Codable, Sendable {
    var items: [GitPullRequest]?
    var error: String?
}

nonisolated struct AgentInfo: Codable, Identifiable, Hashable, Sendable {
    let id: String
    var name: String
    var description: String?
    var kind: String?
    var status: String?
}

// MARK: Follow-ups (messages queued behind a running turn)

nonisolated struct QueuedPrompt: Codable, Identifiable, Hashable, Sendable {
    let id: String
    var content: String
    var createdAt: String
}

nonisolated struct FollowUps: Codable, Sendable, Equatable {
    var queue: [QueuedPrompt]
    /// Why the next queued message couldn't be sent; it stays first and is retried.
    var blocked: String?
}

// MARK: Search

nonisolated struct SearchResults: Codable, Sendable, Equatable {
    nonisolated struct MessageHit: Codable, Identifiable, Hashable, Sendable {
        let id: String
        var sessionId: String
        var projectId: String?
        var sessionTitle: String
        var role: String
        var excerpt: String
    }
    var messages: [MessageHit]
}

// MARK: Modes and skills

/// A command the agent itself accepts, sent as "/name args" in a message.
nonisolated struct AgentCommandInfo: Codable, Identifiable, Hashable, Sendable {
    var name: String
    var description: String
    var inputHint: String?
    var id: String { name }
}

/// The part of `harnessStatus` the phone reads.
nonisolated struct HarnessStatusInfo: Decodable, Sendable {
    nonisolated struct Parsed: Decodable, Sendable { var availableCommands: [AgentCommandInfo]? }
    var parsed: Parsed?
}

nonisolated struct SkillInfo: Codable, Identifiable, Hashable, Sendable {
    let id: String
    var name: String
    var description: String?
    var status: String?
}

// MARK: Usage limits (as reported by a running agent; observations, not balances)

nonisolated struct ProviderUsageSnapshot: Codable, Sendable {
    nonisolated struct Window: Codable, Sendable, Hashable {
        var usedPercent: Double
        var resetsAtMs: Double
        var windowDurationMins: Double?
    }
    nonisolated struct Report: Codable, Sendable, Hashable {
        var providerId: String
        var observedAtMs: Double
        var tier: String
        var window: Window
        var weekly: Window
    }
    nonisolated struct Source: Codable, Sendable, Hashable, Identifiable {
        var sessionId: String
        var title: String
        var report: Report
        var id: String { sessionId }
    }
    var reports: [Source]
}
