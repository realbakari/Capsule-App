import Foundation
import UserNotifications

/*
 * Local notifications for the two moments worth interrupting someone for:
 * an agent is waiting on a decision, and a turn finished. They are posted by
 * this device from what the connection (or a background refresh) saw, so
 * nothing about a conversation passes through any server but the user's own
 * computer. Thread titles are shown; message contents are not.
 */
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    nonisolated static let threadKey = "threadID"
    /// Which paired computer it came from, when it isn't the active one.
    nonisolated static let hostKey = "hostID"
    /// Set by a tapped notification; the root view navigates (switching computer if needed).
    var onOpenThread: ((String, UUID?) -> Void)?

    nonisolated static let approvalKey = "approvalID"
    nonisolated static let approvalCategory = "capsule.approval"
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
        center.setNotificationCategories([UNNotificationCategory(identifier: Self.approvalCategory, actions: [allow, deny],
                                                                 intentIdentifiers: [], options: [])])
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
        var extra = [Self.approvalKey: approval.id]
        if let hostID { extra[Self.hostKey] = hostID.uuidString }
        post(id: "approval-\(approval.id)",
             title: String(localized: "Needs your approval"),
             subtitle: hostID.flatMap(hostName),
             body: thread.map { String(localized: "\($0.title): \(approval.action)") } ?? approval.action,
             threadID: thread?.id, timeSensitive: true,
             category: Self.approvalCategory, extra: extra)
    }

    /// Names the other computer in its notifications, so you know which Mac is asking.
    var hostName: ((UUID) -> String?) = { _ in nil }

    func runSettled(_ run: Run, thread: ChatThread?, visible: Bool, hostID: UUID? = nil) {
        guard !visible, turns != .none, turns == .all || run.status != .completed else { return }
        let title: String = switch run.status {
        case .completed: String(localized: "Turn finished")
        case .failed, .blocked: String(localized: "Turn failed")
        case .cancelled: String(localized: "Turn stopped")
        default: ""
        }
        guard !title.isEmpty else { return }
        post(id: "run-\(run.id)", title: title, subtitle: hostID.flatMap(hostName), body: thread?.title ?? "",
             threadID: thread?.id ?? run.sessionId, timeSensitive: false,
             extra: hostID.map { [Self.hostKey: $0.uuidString] } ?? [:])
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
