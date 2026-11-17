import SwiftUI

/// One step the agent took, folded from the several updates a tool call sends.
nonisolated struct ToolStep: Identifiable, Equatable {
    enum State: Equatable { case running, done, failed }
    let id: String
    var title: String
    var kind: String?
    var state: State
    /// What the tool was given, when it differs from the title.
    var input: String? = nil
    /// What it returned (direct mode), or the runtime's summary (Gateway). For
    /// long output, its first lines; `outputTail` holds the last.
    var output: String? = nil
    /// The last lines of a long output, where errors and summaries print.
    var outputTail: String? = nil
    /// Lines the computer dropped between `output` and `outputTail`.
    var omittedLines: Int? = nil
    var outputTruncated = false
    /// How a command exited, when the agent said.
    var exitCode: Int? = nil
    /// When the call was first seen, for ordering it among the turn's notes and messages.
    var startedAt = ""

    static func fold(_ events: [RunEvent]) -> [ToolStep] {
        var order: [String] = []
        var steps: [String: ToolStep] = [:]
        for event in events where event.type == "tool" {
            let key = event.data?["toolCallId"]?.string ?? event.id
            let status = event.data?["status"]?.string
            let state: State = status == "failed" ? .failed : status == "completed" ? .done : .running
            var step = steps[key] ?? {
                order.append(key)
                return ToolStep(id: key, title: event.data?["title"]?.string ?? event.message, kind: event.data?["kind"]?.string, state: state,
                                startedAt: event.timestamp)
            }()
            step.state = state
            if step.kind == nil { step.kind = event.data?["kind"]?.string }
            if let title = event.data?["title"]?.string, !title.isEmpty, step.title.isEmpty { step.title = title }
            if let details = event.data?["details"] {
                if let input = details["input"]?.string, !input.isEmpty { step.input = input }
                if let output = details["output"]?.string, !output.isEmpty { step.output = output }
                if let tail = details["outputTail"]?.string { step.outputTail = tail }
                if case .number(let omitted)? = details["omittedLines"] { step.omittedLines = Int(omitted) }
                if case .bool(true)? = details["truncated"] { step.outputTruncated = true }
                if case .number(let code)? = details["exitCode"] { step.exitCode = Int(code) }
            } else if let text = event.data?["data"]?["text"]?.string, !text.isEmpty, state != .running {
                step.output = Self.stripSummary(text)
            }
            steps[key] = step
        }
        return order.compactMap { key in
            guard var step = steps[key] else { return nil }
            if step.kind == nil { step.kind = inferKind(step.title) }
            return step
        }
    }

    /// Whether the middle of the output was dropped, leaving a head and a tail.
    var isOutputSplit: Bool { outputTail != nil && (omittedLines ?? 0) > 0 }

    /// The output as the computer kept it: the head, a line saying how much
    /// was dropped, then the tail.
    static func keptOutput(head: String, tail: String?, omitted: Int?) -> String {
        guard let tail, let omitted, omitted > 0 else { return head }
        let gap = omitted == 1 ? String(localized: "… 1 line not kept …")
            : String(localized: "… \(omitted.formatted()) lines not kept …")
        return "\(head)\n\(gap)\n\(tail)"
    }

    /// The command without the shell that wraps it: `/bin/zsh -lc "git status"` → `git status`.
    /// The command itself. A step titled only by its tool ("Bash") is named by the command it ran.
    var command: String {
        let named = Self.unwrapShell(title)
        let toolOnly = ["bash", "shell", "terminal", "execute", "run", "command"].contains(named.lowercased())
        guard toolOnly, let input, let line = input.split(whereSeparator: \.isNewline).first.map(String.init),
              !line.trimmingCharacters(in: .whitespaces).isEmpty else { return named }
        let command = Self.unwrapShell(line)
        return command.count > 80 ? String(command.prefix(79)) + "…" : command
    }

    static func unwrapShell(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        for prefix in ["/bin/zsh -lc ", "/bin/bash -lc ", "/bin/zsh -c ", "/bin/bash -c ", "zsh -lc ", "bash -lc ", "sh -c ", "/bin/sh -c "]
        where trimmed.hasPrefix(prefix) {
            var inner = String(trimmed.dropFirst(prefix.count))
            if let quote = inner.first, quote == "\"" || quote == "'", inner.count >= 2, inner.last == quote {
                inner = String(inner.dropFirst().dropLast())
            }
            return inner
        }
        return trimmed
    }

    /// Gateway summaries read "tool call (completed): ```console …```"; keep the body.
    static func stripSummary(_ text: String) -> String {
        var body = text
        if let colon = body.range(of: "): ") { body = String(body[colon.upperBound...]) }
        body = body.trimmingCharacters(in: .whitespacesAndNewlines)
        if body.hasPrefix("```") {
            body = String(body.drop { $0 != "\n" && $0 != " " }).trimmingCharacters(in: .whitespaces)
            if body.hasSuffix("```") { body = String(body.dropLast(3)) }
        }
        return body.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Some agents name the tool instead of sending a kind; read the name.
    static func inferKind(_ title: String) -> String? {
        let name = title.lowercased()
        if name.contains("terminal") || name.contains("shell") || name.contains("bash") || name.contains("exec") || name.hasPrefix("run") { return "execute" }
        if name.contains("edit") || name.contains("write") || name.contains("patch") || name.contains("replace") { return "edit" }
        if name.contains("read") || name.contains("view") || name.contains("open") { return "read" }
        if name.contains("search") || name.contains("grep") || name.contains("find") || name.contains("glob") || name.contains("list") { return "search" }
        if name.contains("fetch") || name.contains("web") || name.contains("http") { return "fetch" }
        if name.contains("delete") || name.contains("remove") { return "delete" }
        return nil
    }

    /// "Ran npm test" — a verb for the kind, so a collapsed live row reads as a sentence.
    var sentence: String {
        let verb: String = switch kind {
        case "execute": state == .running ? String(localized: "Running") : String(localized: "Ran")
        case "edit": state == .running ? String(localized: "Editing") : String(localized: "Edited")
        case "read": state == .running ? String(localized: "Reading") : String(localized: "Read")
        case "search": state == .running ? String(localized: "Searching") : String(localized: "Searched")
        case "fetch": state == .running ? String(localized: "Fetching") : String(localized: "Fetched")
        case "think": String(localized: "Thinking")
        default: ""
        }
        let subject = kind == "edit" || kind == "read" ? (title as NSString).lastPathComponent : command
        return verb.isEmpty ? title : "\(verb) \(subject)"
    }
}

nonisolated struct PlanEntry: Identifiable, Equatable {
    let id: String
    let content: String
    let status: String

    var isDone: Bool { status == "completed" }
    var isActive: Bool { status == "inProgress" || status == "in_progress" }

    static func latest(in events: [RunEvent]) -> [PlanEntry] {
        guard let plan = events.last(where: { $0.type == "plan" }),
              case .array(let entries)? = plan.data?["entries"] else { return [] }
        return entries.enumerated().compactMap { index, entry in
            guard let content = entry["content"]?.string else { return nil }
            return PlanEntry(id: entry["id"]?.string ?? "\(index)", content: content, status: entry["status"]?.string ?? "pending")
        }
    }
}

/// One row in a turn's work, in the order it happened.
nonisolated enum WorkEntry: Identifiable, Equatable {
    case step(ToolStep)
    /// Bookkeeping the computer recorded: an answer given, context compacted.
    case note(id: String, symbol: String, text: String, at: String)
    /// What the agent reasoned between steps, consecutive updates joined.
    case thought(id: String, text: String, at: String)
    /// A progress note the agent wrote before its final answer.
    case message(ChatMessage)

    var id: String {
        switch self {
        case .step(let step): "s-\(step.id)"
        case .note(let id, _, _, _): "n-\(id)"
        case .thought(let id, _, _): "t-\(id)"
        case .message(let message): "m-\(message.id)"
        }
    }

    private var at: String {
        switch self {
        case .step(let step): step.startedAt
        case .note(_, _, _, let at), .thought(_, _, let at): at
        case .message(let message): message.createdAt
        }
    }

    private static let notes: [String: String] = [
        "approval.resolved": "hand.raised",
        "question.answered": "questionmark.bubble",
        "compaction": "arrow.down.right.and.arrow.up.left",
    ]

    /// Steps, notes, reasoning and interim messages merged by time. Event types the
    /// phone doesn't know are left out rather than shown raw.
    static func timeline(events: [RunEvent], interim: [ChatMessage] = []) -> [WorkEntry] {
        var entries: [WorkEntry] = ToolStep.fold(events).map(WorkEntry.step)
        var thought: (id: String, text: String, at: String)?
        func closeThought() {
            if let open = thought, !open.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                entries.append(.thought(id: open.id, text: open.text, at: open.at))
            }
            thought = nil
        }
        for event in events {
            if event.type == "thinking" {
                let chunk = event.message
                if var open = thought {
                    // A segment is a new stretch of reasoning: its own paragraph, not a continuation.
                    if event.data?["segment"]?.bool == true {
                        open.text = open.text.isEmpty ? chunk : open.text + "\n\n" + chunk
                    } else {
                        open.text = chunk.hasPrefix(open.text) ? chunk : open.text + chunk
                    }
                    thought = open
                } else {
                    thought = (event.id, chunk, event.timestamp)
                }
                continue
            }
            // Tool updates arrive between reasoning chunks; only a different kind of row ends a thought.
            if event.type == "tool" { continue }
            closeThought()
            if let symbol = notes[event.type], !event.message.isEmpty {
                entries.append(.note(id: event.id, symbol: symbol, text: event.message, at: event.timestamp))
            }
        }
        closeThought()
        entries += interim.map(WorkEntry.message)
        return entries.enumerated().sorted { ($0.element.at, $0.offset) < ($1.element.at, $1.offset) }.map(\.element)
    }
}

/// How a settled turn's fold reads.
nonisolated enum TurnLabel {
    /// When a turn ended, short enough for a phone row: the time today, then "Yesterday", then the day.
    /// The full date and time go to VoiceOver.
    static func stamp(_ date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        if calendar.isDate(date, inSameDayAs: now) { return date.formatted(date: .omitted, time: .shortened) }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: yesterday) {
            return String(localized: "Yesterday")
        }
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
        return sameYear ? date.formatted(.dateTime.day().month(.abbreviated)) : date.formatted(.dateTime.day().month(.abbreviated).year())
    }

    /// "42s", "3m 5s", "1h 2m"; whole units drop their zero.
    static func duration(_ seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded())
        if total < 60 { return "\(total)s" }
        let minutes = total / 60, rest = total % 60
        if minutes < 60 { return rest == 0 ? "\(minutes)m" : "\(minutes)m \(rest)s" }
        let hours = minutes / 60, restMinutes = minutes % 60
        return restMinutes == 0 ? "\(hours)h" : "\(hours)h \(restMinutes)m"
    }

    /// When the turn ended: the run's own time, else its answer's.
    static func end(_ run: Run, answerAt: String?) -> Date? {
        (run.completedAt ?? answerAt).flatMap(Timestamp.date)
    }

    static func fold(_ run: Run, answerAt: String?) -> String {
        let seconds = Timestamp.date(run.createdAt).flatMap { start in end(run, answerAt: answerAt).map { $0.timeIntervalSince(start) } }
        let duration = seconds.flatMap { $0 >= 0 ? Self.duration($0) : nil }
        if run.status == .cancelled {
            if run.error?.hasPrefix("Interrupted") == true {
                return duration.map { String(localized: "Interrupted after \($0)") } ?? String(localized: "Interrupted")
            }
            return duration.map { String(localized: "You stopped after \($0)") } ?? String(localized: "You stopped this turn")
        }
        return duration.map { String(localized: "Worked for \($0)") } ?? String(localized: "Worked")
    }
}

/*
 * The work behind a turn, inline in the transcript. A live turn keeps its
 * last few steps visible with the current one shimmering, so a glance says
 * what the agent is doing. Once it settles, everything between the prompt and
 * the answer folds under one line, "Worked for 3m", with the time it ended:
 * the steps, its reasoning, and the progress notes it wrote along the way.
 */
struct WorkLogView: View {
    @Environment(Workspace.self) private var workspace
    let run: Run
    /// This turn's log alone: other turns' tool events don't re-run this view.
    let log: RunLog
    let model: ThreadModel
    /// Assistant messages before the final answer; they fold with the steps.
    var interim: [ChatMessage] = []
    /// When the final answer arrived, for the duration if the run didn't say.
    var answerAt: String? = nil
    var highlight: String? = nil
    let showChanges: () -> Void
    @State private var liveExpanded = false

    private var live: Bool { run.status.isLive }
    private var expanded: Bool { live ? liveExpanded : model.openFolds.contains(run.id) }

    private func toggle() {
        if live { liveExpanded.toggle() }
        else if model.openFolds.contains(run.id) { model.openFolds.remove(run.id) }
        else { model.openFolds.insert(run.id) }
    }

    var body: some View {
        let events = log.events
        let entries = WorkEntry.timeline(events: events, interim: live ? [] : interim)
        let steps = ToolStep.fold(events)
        let plan = PlanEntry.latest(in: events)
        VStack(alignment: .leading, spacing: 2) {
            summaryRow(steps: steps)
            if !plan.isEmpty, expanded || live {
                PlanCard(entries: plan).padding(.vertical, 6)
            }
            if expanded {
                if log.hasEarlier { earlierRow }
                if let error = log.error, !log.loaded {
                    HStack(spacing: 8) {
                        Text(error).font(.footnote).foregroundStyle(Color.failure).lineLimit(2)
                        Button("Try again") { Task { await workspace.loadEvents(for: run.id, in: model) } }
                            .font(.footnote.weight(.medium)).buttonStyle(.plain).foregroundStyle(Color.textPrimary)
                    }
                    .padding(.leading, 32)
                } else if entries.isEmpty {
                    Text(log.loaded ? "No tool steps were recorded." : "Loading steps…")
                        .font(.footnote)
                        .foregroundStyle(Color.textTertiary)
                        .padding(.leading, 32)
                        .padding(.vertical, 4)
                } else {
                    ForEach(entries) { entry in
                        EntryRow(entry: entry)
                            .background(highlight == entry.id ? Color.attention.opacity(0.12) : .clear, in: .rect(cornerRadius: 10))
                    }
                }
            } else if live {
                ForEach(steps.suffix(3)) { StepRow(step: $0) }
            }
        }
        .animation(.snappy(duration: 0.25), value: expanded)
        .animation(.snappy(duration: 0.25), value: steps.count)
        .task(id: live) {
            if live, !log.loaded { await workspace.loadEvents(for: run.id, in: model) }
        }
        .task(id: expanded) {
            if expanded, !log.loaded { await workspace.loadEvents(for: run.id, in: model) }
        }
    }

    /// The computer sends a turn's newest 200 steps; older ones are a page back.
    private var earlierRow: some View {
        HStack(spacing: 8) {
            Text("Earlier steps are on your computer.").font(.footnote).foregroundStyle(Color.textTertiary)
            if log.earlier != nil {
                if log.isLoadingEarlier { ProgressView().controlSize(.mini) } else {
                    Button("Show earlier") { Task { await workspace.loadEarlierEvents(for: run.id, in: model) } }
                        .font(.footnote.weight(.medium)).buttonStyle(.plain).foregroundStyle(Color.textPrimary)
                        .disabled(!workspace.isConnected)
                }
            }
        }
        .padding(.leading, 32)
        .padding(.vertical, 4)
    }

    private func summaryRow(steps: [ToolStep]) -> some View {
        HStack(spacing: 8) {
            Button {
                Haptics.selection()
                toggle()
            } label: {
                HStack(spacing: 8) {
                    statusTile
                    summaryText(steps: steps)
                        .font(.subheadline)
                        .foregroundStyle(run.status == .failed ? Color.failure : Color.textMuted)
                        .lineLimit(1)
                    Image(systemName: "chevron.down")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.textTertiary)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                    if !live, let end = TurnLabel.end(run, answerAt: answerAt) {
                        Text(TurnLabel.stamp(end))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(Color.textTertiary)
                            .accessibilityLabel(Text("Ended \(end.formatted(date: .abbreviated, time: .shortened))"))
                    }
                }
                .frame(minHeight: 32)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint(Text(expanded ? "Hides the work." : "Shows each step."))
            Spacer(minLength: 0)
            if !live, run.checkpointRef != nil {
                Button(action: showChanges) {
                    Label("Changes", systemImage: "plusminus")
                        .font(.caption.weight(.medium))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Color.subtle, in: .capsule)
                        .overlay(Capsule().strokeBorder(Color.hairline, lineWidth: 0.5))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.textSecondary)
            }
        }
    }

    @ViewBuilder private func summaryText(steps: [ToolStep]) -> some View {
        if live {
            TimelineView(.periodic(from: .now, by: 1)) { _ in
                let current = steps.last { $0.state == .running }
                HStack(spacing: 6) {
                    Text(current?.sentence ?? stateWord).lineLimit(1)
                    if let elapsed { Text(elapsed).foregroundStyle(Color.textTertiary).fixedSize() }
                }
            }
            .shimmering()
        } else {
            Text(TurnLabel.fold(run, answerAt: answerAt))
        }
    }

    private var stateWord: String {
        switch run.status {
        case .queued: String(localized: "Queued")
        case .approvalRequired: String(localized: "Waiting for you")
        default: String(localized: "Working")
        }
    }

    private var elapsed: String? {
        guard let start = Timestamp.date(run.createdAt) else { return nil }
        return TurnLabel.duration(max(1, Date.now.timeIntervalSince(start)))
    }

    @ViewBuilder private var statusTile: some View {
        switch run.status {
        case .queued, .running, .waiting:
            ProgressView().controlSize(.small).frame(width: 24, height: 24)
        case .approvalRequired:
            IconTile(symbol: "hand.raised.fill", tint: .attention, background: .attentionBackground)
        case .completed:
            IconTile(symbol: "checkmark", tint: .success)
        case .failed, .blocked:
            IconTile(symbol: "exclamationmark", tint: .failure, background: .failureBackground)
        case .cancelled:
            IconTile(symbol: "stop.fill", tint: .textMuted)
        }
    }
}

private struct EntryRow: View {
    let entry: WorkEntry

    var body: some View {
        switch entry {
        case .step(let step):
            StepRow(step: step)
        case .note(_, let symbol, let text, _):
            HStack(spacing: 8) {
                IconTile(symbol: symbol, tint: .textTertiary, background: .clear)
                Text(text).font(.footnote).foregroundStyle(Color.textTertiary).lineLimit(2)
            }
            .frame(minHeight: 28)
        case .thought(_, let text, _):
            ThoughtRow(text: text)
        case .message(let message):
            MessageView(message: message)
                .padding(.leading, 32)
                .padding(.vertical, 4)
        }
    }
}

/// The agent's reasoning between steps, folded to one line.
private struct ThoughtRow: View {
    let text: String
    @State private var open = false

    var body: some View {
        Button {
            Haptics.selection()
            open.toggle()
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                IconTile(symbol: "brain", tint: .textMuted, background: .clear)
                Text(open ? text : String(localized: "Thought"))
                    .font(open ? .footnote : .subheadline)
                    .italic(open)
                    .foregroundStyle(Color.textMuted)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.semibold)).imageScale(.small)
                    .foregroundStyle(Color.textTertiary)
                    .rotationEffect(.degrees(open ? 180 : 0))
            }
            .frame(minHeight: 28)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .textSelection(.enabled)
        .accessibilityHint(Text(open ? "Hides the reasoning." : "Shows what the agent was thinking."))
    }
}

private struct StepRow: View {
    let step: ToolStep
    @State private var open = false
    @State private var showAll = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                Haptics.selection()
                open.toggle()
            } label: {
                // Open, the header spells out the command only when no Input block below says it already.
                let spelled = open && !showsInput
                HStack(alignment: spelled ? .top : .center, spacing: 8) {
                    IconTile(symbol: Icons.tool(kind: step.kind), tint: step.state == .failed ? .failure : .textMuted,
                             background: .clear)
                    Text(spelled ? step.command : step.sentence)
                        .font(spelled ? .footnote.monospaced() : .subheadline)
                        .foregroundStyle(step.state == .failed ? Color.failure : Color.textMuted)
                        .lineLimit(spelled ? 6 : 1)
                        .truncationMode(.middle)
                        .multilineTextAlignment(.leading)
                        .padding(.top, spelled ? 4 : 0)
                        .shimmering(step.state == .running)
                    Spacer(minLength: 0)
                    if step.state == .failed {
                        Image(systemName: "xmark.circle.fill").font(.caption).foregroundStyle(Color.failure)
                    }
                    if hasDetail {
                        Image(systemName: "chevron.down")
                            .font(.caption2.weight(.semibold)).imageScale(.small)
                            .foregroundStyle(Color.textTertiary)
                            .rotationEffect(.degrees(open ? 180 : 0))
                            .padding(.top, spelled ? 8 : 0)
                    }
                }
                .frame(minHeight: 28)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityValue(Text(step.state == .running ? "Running" : step.state == .failed ? "Failed" : "Done"))
            .accessibilityHint(hasDetail ? Text(open ? "Hides the output." : "Shows what it ran and returned.") : Text(""))

            if open {
                if showsInput, let input = step.input {
                    DetailBlock(label: "Input", text: input, limit: 12, showAll: $showAll)
                }
                if let output = step.output {
                    // A split output is short by construction (12 lines, then 40), and its tail is the point.
                    DetailBlock(label: outputLabel, text: ToolStep.keptOutput(head: output, tail: step.outputTail, omitted: step.omittedLines),
                                limit: step.isOutputSplit ? .max : 16, showAll: $showAll, truncated: step.outputTruncated)
                }
            }
        }
    }

    private var outputLabel: LocalizedStringKey {
        if let code = step.exitCode, code != 0 { return "Output · exit \(code)" }
        return step.state == .failed && step.exitCode == nil ? "Error" : "Output"
    }

    /// The input differs from what the header already names.
    private var showsInput: Bool {
        step.input.map { $0 != step.title && ToolStep.unwrapShell($0) != step.command } ?? false
    }

    private var hasDetail: Bool { step.output != nil || showsInput }
}

/// A tool's input or output: monospace, scrolls sideways, long text folds.
private struct DetailBlock: View {
    let label: LocalizedStringKey
    let text: String
    let limit: Int
    @Binding var showAll: Bool
    var truncated = false

    var body: some View {
        let lines = text.components(separatedBy: "\n")
        let shown = showAll ? lines : Array(lines.prefix(limit))
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Color.textTertiary)
                .textCase(.uppercase)
            // Wrapped like a diff: a sideways scroll with no indicator read as cut-off text.
            Text(shown.joined(separator: "\n"))
                .font(.caption.monospaced())
                .typesettingLanguage(.explicit(Locale.Language(identifier: "zxx")))
                .foregroundStyle(Color.textSecondary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.codeBackground, in: .rect(cornerRadius: 10, style: .continuous))
            if lines.count > limit {
                Button(showAll ? "Show less" : "Show all \(lines.count) lines") { showAll.toggle() }
                    .font(.caption.weight(.medium))
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.textMuted)
            } else if truncated {
                Text("Shortened by your computer.").font(.caption).foregroundStyle(Color.textTertiary)
            }
        }
        .padding(.leading, 32)
    }
}

private struct PlanCard: View {
    let entries: [PlanEntry]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Plan", systemImage: "list.bullet.clipboard")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.textSecondary)
                Spacer()
                Text("\(entries.filter(\.isDone).count)/\(entries.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Color.textTertiary)
            }
            ForEach(entries) { entry in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: entry.isDone ? "checkmark.circle.fill" : entry.isActive ? "circle.dotted.circle" : "circle")
                        .font(.footnote)
                        .foregroundStyle(entry.isDone ? Color.success : entry.isActive ? Color.textPrimary : Color.textTertiary)
                        .symbolEffect(.pulse, isActive: entry.isActive)
                    Text(entry.content)
                        .font(.footnote)
                        .foregroundStyle(entry.isDone ? Color.textTertiary : Color.textPrimary)
                        .strikethrough(entry.isDone, color: Color.textTertiary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(Text(entry.isDone ? "Done" : entry.isActive ? "In progress" : "To do"))
            }
        }
        .padding(12)
        .background(Color.card, in: .rect(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.hairline, lineWidth: 0.5))
    }
}
