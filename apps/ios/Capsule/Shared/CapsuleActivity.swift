import ActivityKit
import AppIntents
import Foundation

/*
 * Shared by the app and the widget extension.
 *
 * A Live Activity for one running turn: what the agent is doing, for how
 * long, and — when it stops to ask — the request, with Allow once and Deny.
 * The app starts and updates it from its own connection; nothing is pushed
 * through any server.
 */
nonisolated struct CapsuleActivityAttributes: ActivityAttributes, Sendable {
    nonisolated struct ContentState: Codable, Hashable, Sendable {
        enum Phase: String, Codable, Hashable, Sendable { case working, approval, finished, failed, stopped }
        var phase: Phase
        /// "Running npm test", "Editing Forecast.swift"…
        var step: String?
        var startedAt: Date
        var finishedAt: Date?
        var approvalID: String?
        var approvalAction: String?
        /// The command or file the agent asked about.
        var approvalDetail: String?
    }

    var threadID: String
    var threadTitle: String
    var projectName: String
}

/// What the Home Screen widget shows. Written by the app, read by the widget.
nonisolated struct WidgetSnapshot: Codable, Sendable, Equatable {
    nonisolated struct Item: Codable, Sendable, Equatable, Identifiable {
        var id: String
        var title: String
        var project: String
        var needsYou: Bool
    }
    var computerName: String
    var needsYou: Int
    var working: Int
    var items: [Item]
    var updatedAt: Date
    var connected: Bool

    static let key = "widget.snapshot.v1"

    static func load() -> WidgetSnapshot? {
        guard let data = SharedStore.defaults?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    func save() {
        SharedStore.defaults?.set(try? JSONEncoder().encode(self), forKey: Self.key)
    }

    static let placeholder = WidgetSnapshot(computerName: "Capsule", needsYou: 1, working: 1, items: [
        Item(id: "a", title: "Fix the flaky date tests", project: "weather-app", needsYou: true),
        Item(id: "b", title: "Show the hourly forecast as a chart", project: "weather-app", needsYou: false),
    ], updatedAt: .now, connected: true)
}

/*
 * Allow once and Deny on the Live Activity. They run in the app's process,
 * after the person unlocks the phone, and answer at most once: perform() can
 * be re-run by the system, so a decision already sent is not sent again.
 */
nonisolated enum ApprovalHandling {
    /// Set by the app at launch; the widget extension never sets it.
    nonisolated(unsafe) static var answer: (@MainActor (String, Bool) async -> Bool)?
}

struct AllowOnceIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Allow once"
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
    static let isDiscoverable = false

    @Parameter(title: "Approval") var approvalID: String

    init() {}
    init(approvalID: String) { self.approvalID = approvalID }

    @MainActor func perform() async throws -> some IntentResult {
        _ = await ApprovalHandling.answer?(approvalID, true)
        return .result()
    }
}

struct DenyIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Deny"
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
    static let isDiscoverable = false

    @Parameter(title: "Approval") var approvalID: String

    init() {}
    init(approvalID: String) { self.approvalID = approvalID }

    @MainActor func perform() async throws -> some IntentResult {
        _ = await ApprovalHandling.answer?(approvalID, false)
        return .result()
    }
}
