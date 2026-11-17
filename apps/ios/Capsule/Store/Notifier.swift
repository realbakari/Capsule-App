import Foundation
import UserNotifications

/*
 * Local notifications for the moments worth interrupting someone for: an
 * agent is waiting on a decision or a question, and a turn ended. They are
 * posted by this device from what the connection (or a background refresh)
 * saw, so nothing about a conversation passes through any server but the
 * user's own computer. The wording follows the computer's own notices: the
 * thread's name, then what happened and why. Replies are never shown.
 *
 * Turn endings that arrive together post as one notification. Approvals and
 * questions post at once and alone: each carries its own answer.
 */
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    nonisolated static let threadKey = "threadID"
    /// Which paired computer it came from, when it isn't the active one.
    nonisolated static let hostKey = "hostID"
    /// Set by a tapped notification; the root view navigates (switching computer if needed).
    var onOpenThread: ((String, UUID?) -> Void)?

    nonisolated static let approvalKey = "approvalID"
    nonisolated static let approvalCategory = "capsule.approval"
    /// The agent offered no "allow once": only Deny is offered here.
    nonisolated static let denyOnlyCategory = "capsule.approval.denyOnly"
    /// A question is answered in the thread; the notification only opens it.
    nonisolated static let questionCategory = "capsule.question"
    nonisolated static let allowAction = "capsule.approval.allow"
    nonisolated static let denyAction = "capsule.approval.deny"

    /// Answers an approval from its notification; returns whether it went through.
    var onApprovalAction: ((String, Workspace.Decision, UUID?) async -> Bool)?

    override init() {
        super.init()
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        // Both actions need the phone unlocked: a lock-screen tap must not run commands.
        let allow = UNNotificationAction(identifier: Self.allowAction, title: String(localized: "Allow once"),
                                         options: [.authenticationRequired])
        let deny = UNNotificationAction(identifier: Self.denyAction, title: String(localized: "Deny"),
                                        options: [.authenticationRequired, .destructive])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: Self.approvalCategory, actions: [allow, deny], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: Self.denyOnlyCategory, actions: [deny], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: Self.questionCategory, actions: [], intentIdentifiers: [], options: []),
        ])
    }

    var isEnabled: Bool {
        get { UserDefaults.standard.object(forKey: "notifications.enabled") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "notifications.enabled") }
    }

    /// Which turn endings notify: every one, or only the ones that went wrong.
    enum TurnNotifications: String, CaseIterable { case all, failures, none }

    var approvalsEnabled: Bool {
        get { UserDefaults.standard.object(forKey: "notifications.approvals") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "notifications.approvals") }
    }

    var turns: TurnNotifications {
        get { UserDefaults.standard.string(forKey: "notifications.turns").flatMap(TurnNotifications.init(rawValue:)) ?? .all }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: "notifications.turns") }
    }

    func requestAuthorizationIfNeeded() async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .notDetermined else { return }
        _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
    }

    func approvalRequested(_ approval: Approval, thread: ChatThread?, visible: Bool, hostID: UUID? = nil) {
        guard !visible, approvalsEnabled else { return }
        let notice = Notice.approval(approval, threadID: thread?.id, threadTitle: Self.title(thread))
        var extra: [String: String] = [:]
        if !approval.isQuestion { extra[Self.approvalKey] = approval.id }
        if let hostID { extra[Self.hostKey] = hostID.uuidString }
        post(id: "approval-\(approval.id)", title: notice.threadTitle, subtitle: hostID.flatMap(hostName), body: notice.body,
             threadID: thread?.id, timeSensitive: true,
             category: approval.isQuestion ? Self.questionCategory : approval.canApproveOnce ? Self.approvalCategory : Self.denyOnlyCategory,
             extra: extra)
    }

    /// Names the other computer in its notifications, so you know which Mac is asking.
    var hostName: ((UUID) -> String?) = { _ in nil }

    private struct Pending { var notice: Notice; var hostID: UUID?; var runID: String }
    private var burst: [Pending] = []
    private var burstTask: Task<Void, Never>?

    func runSettled(_ run: Run, thread: ChatThread?, visible: Bool, hostID: UUID? = nil) {
        guard !visible, turns != .none, turns == .all || run.status != .completed,
              let notice = Notice.run(run, threadTitle: Self.title(thread)) else { return }
        burst.append(Pending(notice: notice, hostID: hostID, runID: run.id))
        guard burstTask == nil else { return }
        // Turns that end within a second of each other are one thing to read.
        burstTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            self?.flushBurst()
        }
    }

    /// Posts any turn endings still being gathered.
    func flushTurns() {
        burstTask?.cancel()
        flushBurst()
    }

    private func flushBurst() {
        guard !burst.isEmpty else { burstTask = nil; return }
        let items = burst
        burst = []
        burstTask = nil
        guard let summary = Notice.coalesce(items.map(\.notice)) else { return }
        let lead = items.first { $0.notice.threadID == summary.threadID } ?? items[0]
        let hosts = Set(items.map(\.hostID))
        let subtitle = hosts.count == 1 ? lead.hostID.flatMap(hostName) : nil
        post(id: items.count == 1 ? "run-\(lead.runID)" : "runs-\(UUID().uuidString)", title: summary.title, subtitle: subtitle,
             body: summary.body, threadID: summary.threadID, timeSensitive: false,
             extra: lead.hostID.map { [Self.hostKey: $0.uuidString] } ?? [:])
    }

    private static func title(_ thread: ChatThread?) -> String {
        guard let title = thread?.title, !title.isEmpty else { return String(localized: "Untitled thread") }
        return title
    }

    private func post(id: String, title: String, subtitle: String? = nil, body: String, threadID: String?, timeSensitive: Bool,
                      category: String? = nil, extra: [String: String] = [:]) {
        guard isEnabled else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        if let subtitle { content.subtitle = subtitle }
        content.body = body
        content.sound = .default
        content.threadIdentifier = threadID ?? "capsule"
        var info: [String: String] = extra
        if let threadID { info[Self.threadKey] = threadID }
        content.userInfo = info
        if let category { content.categoryIdentifier = category }
        // Time-sensitive delivery needs an entitlement the user may not add;
        // without it iOS treats the request as active, so ask for that.
        content.interruptionLevel = .active
        content.relevanceScore = timeSensitive ? 1 : 0.5
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification)
        async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        let action = response.actionIdentifier
        let hostID = (info[Self.hostKey] as? String).flatMap(UUID.init(uuidString:))
        if action == Self.allowAction || action == Self.denyAction, let approvalID = info[Self.approvalKey] as? String {
            let decision: Workspace.Decision = action == Self.allowAction ? .once : .deny
            await answer(approvalID: approvalID, decision: decision, threadID: info[Self.threadKey] as? String, hostID: hostID)
            return
        }
        guard let threadID = info[Self.threadKey] as? String else { return }
        await MainActor.run { self.onOpenThread?(threadID, hostID) }
    }

    private func answer(approvalID: String, decision: Workspace.Decision, threadID: String?, hostID: UUID?) async {
        let done = await onApprovalAction?(approvalID, decision, hostID) ?? false
        guard !done else { return }
        // Not resent automatically: it may have reached the computer already.
        post(id: "approval-failed-\(approvalID)", title: String(localized: "Couldn't confirm your answer"),
             body: String(localized: "Open Capsule to check the approval before answering again."),
             threadID: threadID, timeSensitive: true)
    }
}
