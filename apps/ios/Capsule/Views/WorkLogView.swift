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
    /// What it returned (direct mode), or the runtime's summary (Gateway).
    var output: String? = nil
    var outputTruncated = false

    static func fold(_ events: [RunEvent]) -> [ToolStep] {
        var order: [String] = []
        var steps: [String: ToolStep] = [:]
        for event in events where event.type == "tool" {
            let key = event.data?["toolCallId"]?.string ?? event.id
            let status = event.data?["status"]?.string
            let state: State = status == "failed" ? .failed : status == "completed" ? .done : .running
            var step = steps[key] ?? {
                order.append(key)
                return ToolStep(id: key, title: event.data?["title"]?.string ?? event.message, kind: event.data?["kind"]?.string, state: state)
            }()
            step.state = state
            if step.kind == nil { step.kind = event.data?["kind"]?.string }
            if let title = event.data?["title"]?.string, !title.isEmpty, step.title.isEmpty { step.title = title }
            if let details = event.data?["details"] {
                if let input = details["input"]?.string, !input.isEmpty { step.input = input }
                if let output = details["output"]?.string, !output.isEmpty { step.output = output }
                if case .bool(true)? = details["truncated"] { step.outputTruncated = true }
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

    /// The command without the shell that wraps it: `/bin/zsh -lc "git status"` → `git status`.
    var command: String { Self.unwrapShell(title) }

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

/*
 * The work behind a turn, inline in the transcript. Finished turns fold to
 * one line — what happened, how long, how many steps — that opens into the
 * steps and the plan. A live turn keeps its last few steps visible with the
 * current one shimmering, so a glance says what the agent is doing.
 */
struct WorkLogView: View {
    @Environment(Workspace.self) private var workspace
    let run: Run
    /// This turn's log alone: other turns' tool events don't re-run this view.
    let log: RunLog
    let model: ThreadModel
    let showChanges: () -> Void
    @State private var expanded = false

    var body: some View {
        let events = log.events
        let steps = ToolStep.fold(events)
        let plan = PlanEntry.latest(in: events)
        let live = run.status.isLive
        VStack(alignment: .leading, spacing: 2) {
            summaryRow(steps: steps, live: live)
            if !plan.isEmpty, expanded || live {
                PlanCard(entries: plan).padding(.vertical, 6)
            }
            if expanded {
                if let error = log.error, !log.loaded {
                    HStack(spacing: 8) {
                        Text(error).font(.footnote).foregroundStyle(Color.failure).lineLimit(2)
                        Button("Try again") { Task { await workspace.loadEvents(for: run.id, in: model) } }
                            .font(.footnote.weight(.medium)).buttonStyle(.plain).foregroundStyle(Color.textPrimary)
                    }
                    .padding(.leading, 32)
                } else if steps.isEmpty {
                    Text(log.loaded ? "No tool steps were recorded." : "Loading steps…")
                        .font(.footnote)
                        .foregroundStyle(Color.textTertiary)
                        .padding(.leading, 32)
                        .padding(.vertical, 4)
                } else {
                    ForEach(steps) { StepRow(step: $0) }
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
    }

    private func summaryRow(steps: [ToolStep], live: Bool) -> some View {
        HStack(spacing: 8) {
            Button {
                Haptics.selection()
                expanded.toggle()
                if expanded, !log.loaded {
                    Task { await workspace.loadEvents(for: run.id, in: model) }
                }
            } label: {
                HStack(spacing: 8) {
                    statusTile
                    summaryText(steps: steps, live: live)
                        .font(.subheadline)
                        .foregroundStyle(run.status == .failed ? Color.failure : Color.textMuted)
                        .lineLimit(1)
                    Image(systemName: "chevron.down")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.textTertiary)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .frame(minHeight: 32)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint(Text(expanded ? "Hides the steps." : "Shows each step."))
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

    @ViewBuilder private func summaryText(steps: [ToolStep], live: Bool) -> some View {
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
            let count = steps.count
            let duration = elapsed.map { String(localized: " for \($0)") } ?? ""
            let tail = count == 1 ? String(localized: " · 1 step") : count > 1 ? String(localized: " · \(count) steps") : ""
            Text("\(stateWord)\(duration)\(tail)")
        }
    }

    private var stateWord: String {
        switch run.status {
        case .queued: String(localized: "Queued")
        case .running, .waiting: String(localized: "Working")
        case .approvalRequired: String(localized: "Waiting for your approval")
        case .completed: String(localized: "Worked")
        case .failed, .blocked: String(localized: "Failed")
        case .cancelled: String(localized: "Stopped")
        }
    }

    private var elapsed: String? {
        guard let start = Timestamp.date(run.createdAt) else { return nil }
        let end = run.status.isLive ? Date.now : (run.completedAt.flatMap(Timestamp.date) ?? Timestamp.date(run.updatedAt) ?? .now)
        let seconds = max(1, Int(end.timeIntervalSince(start)))
        if seconds < 60 { return "\(seconds)s" }
        if seconds < 3600 { return "\(seconds / 60)m \(seconds % 60)s" }
        return "\(seconds / 3600)h \((seconds % 3600) / 60)m"
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
                HStack(alignment: open ? .top : .center, spacing: 8) {
                    IconTile(symbol: Icons.tool(kind: step.kind), tint: step.state == .failed ? .failure : .textMuted,
                             background: .clear)
                    Text(open ? step.command : step.sentence)
                        .font(open ? .footnote.monospaced() : .subheadline)
                        .foregroundStyle(step.state == .failed ? Color.failure : Color.textMuted)
                        .lineLimit(open ? 6 : 1)
                        .truncationMode(.middle)
                        .multilineTextAlignment(.leading)
                        .padding(.top, open ? 4 : 0)
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
                            .padding(.top, open ? 8 : 0)
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
                if let input = step.input, input != step.title, ToolStep.unwrapShell(input) != step.command {
                    DetailBlock(label: "Input", text: input, limit: 12, showAll: $showAll)
                }
                if let output = step.output {
                    DetailBlock(label: step.state == .failed ? "Error" : "Output", text: output, limit: 16, showAll: $showAll,
                                truncated: step.outputTruncated)
                }
            }
        }
    }

    private var hasDetail: Bool {
        step.output != nil || (step.input.map { $0 != step.title && ToolStep.unwrapShell($0) != step.command } ?? false)
    }
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
            ScrollView(.horizontal, showsIndicators: false) {
                Text(shown.joined(separator: "\n"))
                    .font(.caption.monospaced())
                    .foregroundStyle(Color.textSecondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: true, vertical: false)
                    .padding(10)
            }
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
