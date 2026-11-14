import ActivityKit
import Foundation

/*
 * Supervising from the Lock Screen: a Live Activity for each running turn,
 * and the numbers the Home Screen widget shows. Both are fed by the same
 * events the thread list uses, so they can't disagree with it.
 */
extension Workspace {
    /// Called once at launch: answers from the Live Activity go through the same path as notification actions.
    func installApprovalHandling() {
        ApprovalHandling.answer = { [weak self] id, allow in
            guard let self, self.liveActivities.claim(approvalID: id) else { return false }
            return await self.resolveFromNotification(approvalID: id, allow ? .once : .deny)
        }
        liveActivities.reconcile(liveThreadIDs: Set(latestRuns.values.filter(\.status.isLive).map(\.sessionId)))
    }

    var liveActivitiesEnabled: Bool {
        get { liveActivities.isEnabled }
        set { liveActivities.isEnabled = newValue }
    }

    func supervise(_ event: ServerEvent) {
        switch event {
        case .run(let run):
            updateActivity(threadID: run.sessionId)
        case .runEvent(let event):
            guard event.type == "tool", let step = ToolStep.fold([event]).first, step.state == .running else { return }
            guard let threadID = event.sessionId ?? latestRuns.first(where: { $0.value.id == event.runId })?.key else { return }
            liveSteps[threadID] = step.sentence
            updateActivity(threadID: threadID)
        case .approval(let approval):
            if let threadID = latestRuns.first(where: { $0.value.id == approval.runId })?.key { updateActivity(threadID: threadID) }
        default:
            break
        }
    }

    private func updateActivity(threadID: String) {
        guard let run = latestRuns[threadID] else { return }
        let started = Timestamp.date(run.createdAt) ?? .now
        let thread = thread(threadID)
        let project = thread.flatMap { project($0.projectId) }?.name ?? ""
        if run.status.isLive {
            let approval = pendingApprovals.first { $0.runId == run.id }
            let state = CapsuleActivityAttributes.ContentState(
                phase: approval != nil || run.status == .approvalRequired ? .approval : .working,
                step: liveSteps[threadID], startedAt: started, finishedAt: nil,
                approvalID: approval?.id, approvalAction: approval?.action,
                approvalDetail: approval.map { Self.approvalDetail($0) })
            liveActivities.show(threadID: threadID, title: thread?.title ?? "", project: project, state: state)
        } else {
            liveSteps[threadID] = nil
            let phase: CapsuleActivityAttributes.ContentState.Phase = switch run.status {
            case .completed: .finished
            case .cancelled: .stopped
            default: .failed
            }
            let state = CapsuleActivityAttributes.ContentState(phase: phase, step: nil, startedAt: started,
                                                               finishedAt: Timestamp.date(run.completedAt ?? run.updatedAt) ?? .now)
            liveActivities.finish(threadID: threadID, state: state)
        }
    }

    /// The command or path the agent asked about, short enough for the Lock Screen.
    static func approvalDetail(_ approval: Approval) -> String {
        let text = approval.subject.map(ToolStep.unwrapShell) ?? (approval.target.isEmpty ? approval.reason : approval.target)
        return String(text.prefix(140))
    }

    func publishWidget() {
        let open = threads.filter { !$0.isArchived }
        let statuses = open.map { ($0, status(of: $0)) }
        let needs = statuses.filter { $0.1 == .needsApproval }
        let working = statuses.filter { $0.1 == .working }
        let items = (needs + working).prefix(4).map { thread, status in
            WidgetSnapshot.Item(id: thread.id, title: thread.title.isEmpty ? String(localized: "Untitled thread") : thread.title,
                                project: project(thread.projectId)?.name ?? "", needsYou: status == .needsApproval)
        }
        widgetPublisher.publish(WidgetSnapshot(
            computerName: isSample ? String(localized: "Sample workspace") : activeHost?.name ?? "Capsule",
            needsYou: needs.count, working: working.count, items: Array(items),
            updatedAt: lastSynced ?? .now, connected: isConnected || isSample))
    }
}
