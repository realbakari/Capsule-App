import ActivityKit
import Foundation
import WidgetKit

/*
 * One Live Activity per running turn, driven by the app's own connection.
 *
 * iOS lets an app start an activity only while it's in the foreground, so a
 * turn already running when you lock the phone keeps its activity, and one
 * that starts while the app is closed doesn't get one (that would need push).
 * Updates are coalesced: the system budgets them, and a step that changes
 * every few hundred milliseconds would burn the budget for nothing.
 */
@MainActor
final class LiveActivities {
    typealias State = CapsuleActivityAttributes.ContentState
    /// Thread id → the activity's id. Activities aren't Sendable, so they're
    /// looked up again off the main actor whenever one changes.
    private var activities: [String: String] = [:]
    private var phases: [String: State.Phase] = [:]
    private var lastPush: [String: Date] = [:]
    private var pending: [String: State] = [:]
    private var answered: Set<String> = []

    var isEnabled: Bool {
        get { UserDefaults.standard.object(forKey: "liveActivities.enabled") as? Bool ?? true }
        set {
            UserDefaults.standard.set(newValue, forKey: "liveActivities.enabled")
            if !newValue { endAll() }
        }
    }

    /// Ends activities left over from a previous launch whose turn is no longer live.
    func reconcile(liveThreadIDs: Set<String>) {
        for activity in Activity<CapsuleActivityAttributes>.activities {
            let threadID = activity.attributes.threadID
            if liveThreadIDs.contains(threadID) {
                activities[threadID] = activity.id
                phases[threadID] = activity.content.state.phase
            } else {
                Self.end(activity.id, nil, .immediate)
            }
        }
    }

    /// Starts or updates the activity for a thread's live turn.
    func show(threadID: String, title: String, project: String, state: State) {
        guard isEnabled, ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        if let id = activities[threadID] {
            schedule(id, threadID: threadID, state: state)
            return
        }
        let attributes = CapsuleActivityAttributes(threadID: threadID, threadTitle: title.isEmpty ? String(localized: "Untitled thread") : title,
                                                   projectName: project)
        do {
            let activity = try Activity.request(attributes: attributes, content: .init(state: state, staleDate: nil), pushType: nil)
            activities[threadID] = activity.id
            phases[threadID] = state.phase
            lastPush[threadID] = .now
        } catch {
            // Not allowed from the background, or turned off by the person: nothing to show.
        }
    }

    /// Shows the final state for a while, then lets it go.
    func finish(threadID: String, state: State) {
        guard let id = activities.removeValue(forKey: threadID) else { return }
        pending[threadID] = nil
        phases[threadID] = nil
        Self.end(id, ActivityContent(state: state, staleDate: nil), .after(.now + 15 * 60))
    }

    func endAll() {
        for id in activities.values { Self.end(id, nil, .immediate) }
        activities = [:]
        phases = [:]
        pending = [:]
    }

    /// An approval answered from the activity is never sent twice, whatever the system replays.
    func claim(approvalID: String) -> Bool {
        answered.insert(approvalID).inserted
    }

    private func schedule(_ id: String, threadID: String, state: State) {
        // Phase changes (an approval arriving) go out at once; step changes at most every 2 s.
        let phaseChanged = phases[threadID] != state.phase
        let since = Date.now.timeIntervalSince(lastPush[threadID] ?? .distantPast)
        if phaseChanged || since >= 2 {
            pending[threadID] = nil
            push(id, threadID: threadID, state: state)
            return
        }
        let wasPending = pending[threadID] != nil
        pending[threadID] = state
        guard !wasPending else { return }
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(2 - since))
            guard let self, let latest = self.pending.removeValue(forKey: threadID), let id = self.activities[threadID] else { return }
            self.push(id, threadID: threadID, state: latest)
        }
    }

    private func push(_ id: String, threadID: String, state: State) {
        lastPush[threadID] = .now
        phases[threadID] = state.phase
        Task.detached { await Self.find(id)?.update(.init(state: state, staleDate: nil)) }
    }

    private static func end(_ id: String, _ content: ActivityContent<State>?, _ policy: ActivityUIDismissalPolicy) {
        Task.detached { await find(id)?.end(content, dismissalPolicy: policy) }
    }

    nonisolated private static func find(_ id: String) -> Activity<CapsuleActivityAttributes>? {
        Activity<CapsuleActivityAttributes>.activities.first { $0.id == id }
    }
}

/// Keeps the Home Screen widget's numbers current, without reloading it on every event.
@MainActor
final class WidgetPublisher {
    private var last: WidgetSnapshot?
    private var lastReload = Date.distantPast

    func publish(_ snapshot: WidgetSnapshot) {
        var comparable = snapshot
        comparable.updatedAt = last?.updatedAt ?? snapshot.updatedAt
        guard comparable != last else { return }
        let needsYouChanged = snapshot.needsYou != last?.needsYou
        last = snapshot
        snapshot.save()
        // WidgetKit budgets reloads; the counts don't need sub-minute freshness,
        // but a new request for approval shows at once.
        if needsYouChanged || Date.now.timeIntervalSince(lastReload) > 30 {
            lastReload = .now
            WidgetCenter.shared.reloadTimelines(ofKind: "CapsuleStatus")
        }
    }
}
