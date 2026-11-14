import Foundation
import UIKit

/*
 * Leaving and checking in from the background.
 *
 * iOS closes sockets soon after an app leaves the screen. Rather than let
 * that happen at random, the app keeps the connection for a short grace
 * period (so a turn finishing as you lock the phone still notifies), then
 * disconnects cleanly. Occasional background refreshes reconnect briefly,
 * compare what changed, and post the same notifications.
 */
extension Workspace {
    func enterBackground() async {
        let app = UIApplication.shared
        let grace = GraceTask()
        grace.id = app.beginBackgroundTask(withName: "capsule.grace") { grace.end() }
        try? await Task.sleep(for: .seconds(25))
        if app.applicationState == .background {
            await disconnect()
            await stopWatchers()
        }
        grace.end()
    }

    func backgroundCheck() async {
        guard activeHost != nil else { return }
        let before = latestRuns
        let knownApprovals = Set(pendingApprovals.map(\.id))
        connect()
        // Give the connection a moment; background time is short.
        for _ in 0..<40 where !isConnected {
            try? await Task.sleep(for: .milliseconds(250))
        }
        guard isConnected else { await disconnect(); return }
        await refresh()
        for (sessionID, run) in latestRuns {
            if let old = before[sessionID], old.id == run.id, old.status.isLive, !run.status.isLive {
                notifier.runSettled(run, thread: thread(sessionID), visible: false)
            }
        }
        for approval in pendingApprovals where !knownApprovals.contains(approval.id) {
            let sessionID = latestRuns.values.first { $0.id == approval.runId }?.sessionId
            notifier.approvalRequested(approval, thread: sessionID.flatMap(thread), visible: false)
        }
        await disconnect()
    }
}

/// Ends a background task exactly once, from its expiry handler or from the app.
private final class GraceTask {
    var id = UIBackgroundTaskIdentifier.invalid
    func end() {
        guard id != .invalid else { return }
        UIApplication.shared.endBackgroundTask(id)
        id = .invalid
    }
}
