import Foundation
import Observation

/*
 * One open thread: its transcript, its turns, and what is happening in the
 * live one. Kept apart from the workspace so a streaming tool event in one
 * thread does not invalidate the thread list or any other transcript.
 *
 * Within a thread the same rule applies one level down. Each turn's tool log
 * and each turn's streaming reply is its own observable object, created when
 * data for it arrives (never while a view renders). A view observes only the
 * turn it shows, so a tool event in the live turn does not re-run every
 * other turn's work log, and a streamed character does not re-run the whole
 * transcript.
 */
@Observable
final class ThreadModel {
    let threadID: String

    private(set) var messages: [ChatMessage] = []
    private(set) var hasOlder = false
    private(set) var runs: [String: Run] = [:]
    /// One per run, made when the run is first seen.
    private(set) var logs: [String: RunLog] = [:]
    /// Present only while a turn is streaming a reply that isn't saved yet.
    private(set) var replies: [String: LiveReply] = [:]
    /// Messages waiting for the running turn to finish; the computer sends them in order.
    private(set) var followUps = FollowUps(queue: [], blocked: nil)
    var isLoading = false
    var isLoadingOlder = false
    var loadError: String?
    /// Settled turns whose folded work is open.
    var openFolds: Set<String> = []

    init(threadID: String) {
        self.threadID = threadID
    }

    var liveRun: Run? {
        runs.values.filter { $0.status.isLive }.max { $0.createdAt < $1.createdAt }
    }

    // MARK: Applying data

    func replaceMessages(_ page: MessagePage) {
        // Keep anything that arrived live while the page was in flight.
        let ids = Set(page.messages.map(\.id))
        let newer = messages.filter { !ids.contains($0.id) && $0.createdAt >= (page.messages.last?.createdAt ?? "") }
        messages = page.messages + newer
        hasOlder = page.hasMore
    }

    func prependOlder(_ page: MessagePage) {
        let ids = Set(messages.map(\.id))
        messages = page.messages.filter { !ids.contains($0.id) } + messages
        hasOlder = page.hasMore
    }

    func restore(cached: [ChatMessage]) {
        guard messages.isEmpty else { return }
        messages = cached
        hasOlder = true
    }

    func apply(message: ChatMessage) {
        if let index = messages.firstIndex(where: { $0.id == message.id }) {
            messages[index] = message
        } else {
            let at = messages.lastIndex { $0.createdAt <= message.createdAt }.map { $0 + 1 } ?? 0
            messages.insert(message, at: at)
        }
        if message.role == .assistant, let runID = message.runId { replies[runID] = nil }
    }

    func apply(runs list: [Run]) {
        for run in list { apply(run: run) }
    }

    func apply(run: Run) {
        if runs[run.id] != run { runs[run.id] = run }
        if logs[run.id] == nil { logs[run.id] = RunLog(runID: run.id) }
        if !run.status.isLive, messages.contains(where: { $0.runId == run.id && $0.role == .assistant }) {
            replies[run.id] = nil
        }
    }

    func apply(followUps value: FollowUps) {
        if followUps != value { followUps = value }
    }

    func setEvents(_ list: [RunEvent], for runID: String) {
        log(for: runID).replace(with: list)
    }

    func setEvents(_ page: RunEventPage, for runID: String) {
        let log = log(for: runID)
        log.replace(with: page.events)
        log.setEarlier(page)
    }

    func apply(event: RunEvent) {
        if event.type == "assistant" {
            if let reply = replies[event.runId] {
                reply.append(event.message)
            } else {
                let reply = LiveReply()
                reply.append(event.message)
                replies[event.runId] = reply
            }
            return
        }
        log(for: event.runId).append(event)
    }

    /// Only called from data paths, never from a view body.
    private func log(for runID: String) -> RunLog {
        if let log = logs[runID] { return log }
        let log = RunLog(runID: runID)
        logs[runID] = log
        return log
    }
}

/// The tool and plan events of one turn.
@Observable
final class RunLog {
    let runID: String
    private(set) var events: [RunEvent] = []
    private(set) var loaded = false
    /// Why the steps couldn't be loaded, shown with a retry.
    private(set) var error: String?
    /// The computer sends the newest steps first; this is where the older ones start.
    private(set) var earlier: RunEventPage.Cursor?
    /// True when older steps exist but the computer gave no way to page back to them.
    private(set) var earlierUnreachable = false
    var isLoadingEarlier = false
    var hasEarlier: Bool { earlier != nil || earlierUnreachable }

    func fail(_ message: String) { error = message }

    init(runID: String) {
        self.runID = runID
    }

    func replace(with list: [RunEvent]) {
        let ids = Set(list.map(\.id))
        let merged = (list + events.filter { !ids.contains($0.id) }).sorted { $0.timestamp < $1.timestamp }
        if merged != events { events = merged }
        loaded = true
        error = nil
    }

    func setEarlier(_ page: RunEventPage) {
        earlier = page.hasMore == true ? page.before : nil
        earlierUnreachable = page.hasMore == true && page.before == nil
    }

    func prepend(_ page: RunEventPage) {
        let ids = Set(events.map(\.id))
        events = page.events.filter { !ids.contains($0.id) } + events
        setEarlier(page)
    }

    func append(_ event: RunEvent) {
        guard !events.contains(where: { $0.id == event.id }) else { return }
        events.append(event)
    }
}

/// A reply as it streams, before the computer saves it as a message.
@Observable
final class LiveReply {
    private(set) var text = ""

    /// Some agents send the whole reply so far, others only the new part.
    func append(_ chunk: String) {
        text = chunk.hasPrefix(text) ? chunk : text + chunk
    }
}
