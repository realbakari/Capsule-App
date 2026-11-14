import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@main
struct CapsuleWidgets: WidgetBundle {
    var body: some Widget {
        StatusWidget()
        TurnActivity()
    }
}

// MARK: Live Activity

/// One running turn on the Lock Screen and in the Dynamic Island.
struct TurnActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CapsuleActivityAttributes.self) { context in
            LockScreenTurn(attributes: context.attributes, state: context.state)
                .padding(16)
                .activityBackgroundTint(nil)
                .widgetURL(threadURL(context.attributes.threadID))
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    PhaseIcon(phase: state.phase).font(.title3).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Elapsed(state: state).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary).padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.threadTitle).font(.subheadline.weight(.semibold)).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    TurnBody(state: state, compact: true)
                }
            } compactLeading: {
                PhaseIcon(phase: state.phase)
            } compactTrailing: {
                if state.phase == .approval {
                    Text("Needs you").font(.caption2.weight(.semibold)).foregroundStyle(Color("Attention"))
                } else {
                    Elapsed(state: state).font(.caption2.monospacedDigit()).frame(maxWidth: 44)
                }
            } minimal: {
                PhaseIcon(phase: state.phase)
            }
            .widgetURL(threadURL(context.attributes.threadID))
            .keylineTint(state.phase == .approval ? Color("Attention") : nil)
        }
    }
}

private func threadURL(_ id: String) -> URL? {
    var components = URLComponents()
    components.scheme = "capsule"
    components.host = "thread"
    components.queryItems = [URLQueryItem(name: "id", value: id)]
    return components.url
}

struct LockScreenTurn: View {
    let attributes: CapsuleActivityAttributes
    let state: CapsuleActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                PhaseIcon(phase: state.phase)
                VStack(alignment: .leading, spacing: 1) {
                    Text(attributes.threadTitle).font(.subheadline.weight(.semibold)).lineLimit(1)
                    if !attributes.projectName.isEmpty {
                        Text(attributes.projectName).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Elapsed(state: state).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            }
            TurnBody(state: state, compact: false)
        }
    }
}

/// The step, the request, or how it ended.
struct TurnBody: View {
    let state: CapsuleActivityAttributes.ContentState
    let compact: Bool

    var body: some View {
        switch state.phase {
        case .approval:
            VStack(alignment: .leading, spacing: 8) {
                Text(state.approvalAction ?? String(localized: "The agent is asking to continue"))
                    .font(.footnote.weight(.medium))
                    .lineLimit(1)
                if let detail = state.approvalDetail, !detail.isEmpty {
                    Text(detail).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(compact ? 1 : 2)
                }
                if let id = state.approvalID {
                    // Allow once is the filled one: on the Lock Screen it reads as the answer, Deny as the way out.
                    HStack(spacing: 8) {
                        Button(intent: DenyIntent(approvalID: id)) {
                            Text("Deny").frame(maxWidth: .infinity, minHeight: 32)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.primary)
                        .background(.quaternary, in: .capsule)
                        Button(intent: AllowOnceIntent(approvalID: id)) {
                            Text("Allow once").frame(maxWidth: .infinity, minHeight: 32)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.background)
                        .background(.primary, in: .capsule)
                    }
                    .font(.footnote.weight(.semibold))
                }
            }
        case .working:
            Text(state.step ?? String(localized: "Working…"))
                .font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                .contentTransition(.opacity)
        case .finished:
            Text("Finished — open to read the reply").font(.footnote).foregroundStyle(.secondary)
        case .failed:
            Text("The turn failed").font(.footnote).foregroundStyle(Color("Failure"))
        case .stopped:
            Text("Stopped").font(.footnote).foregroundStyle(.secondary)
        }
    }
}

struct PhaseIcon: View {
    let phase: CapsuleActivityAttributes.ContentState.Phase

    var body: some View {
        switch phase {
        case .working:
            Image(systemName: "circle.dotted").symbolEffect(.rotate, options: .repeat(.continuous)).foregroundStyle(.secondary)
                .accessibilityLabel("Working")
        case .approval:
            Image(systemName: "hand.raised.fill").foregroundStyle(Color("Attention")).accessibilityLabel("Needs approval")
        case .finished:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Color("Success")).accessibilityLabel("Finished")
        case .failed:
            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Color("Failure")).accessibilityLabel("Failed")
        case .stopped:
            Image(systemName: "stop.circle.fill").foregroundStyle(.secondary).accessibilityLabel("Stopped")
        }
    }
}

/// A running clock while live, the final duration once settled.
struct Elapsed: View {
    let state: CapsuleActivityAttributes.ContentState

    var body: some View {
        if let end = state.finishedAt {
            Text(Duration.seconds(max(0, end.timeIntervalSince(state.startedAt))).formatted(.time(pattern: .minuteSecond)))
        } else {
            Text(timerInterval: state.startedAt...Date.distantFuture, countsDown: false)
                .multilineTextAlignment(.trailing)
        }
    }
}

// MARK: Home Screen and Lock Screen widget

struct StatusEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

struct StatusProvider: TimelineProvider {
    func placeholder(in context: Context) -> StatusEntry { StatusEntry(date: .now, snapshot: .placeholder) }

    func getSnapshot(in context: Context, completion: @escaping (StatusEntry) -> Void) {
        completion(StatusEntry(date: .now, snapshot: context.isPreview ? .placeholder : WidgetSnapshot.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<StatusEntry>) -> Void) {
        // The app reloads this when something changes; the timeline only ages the "updated" time.
        completion(Timeline(entries: [StatusEntry(date: .now, snapshot: WidgetSnapshot.load())], policy: .after(.now + 30 * 60)))
    }
}

struct StatusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CapsuleStatus", provider: StatusProvider()) { entry in
            StatusView(snapshot: entry.snapshot)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Capsule")
        .description("Threads that need you, and turns still running.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular])
    }
}

struct StatusView: View {
    let snapshot: WidgetSnapshot?
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let snapshot {
            switch family {
            case .accessoryCircular: circular(snapshot)
            case .accessoryRectangular: rectangular(snapshot)
            case .systemMedium: medium(snapshot)
            default: small(snapshot)
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Image("Mark").resizable().scaledToFit().frame(width: 22, height: 22)
                Spacer()
                Text("Pair with a computer in Capsule to see your threads here.").font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func circular(_ s: WidgetSnapshot) -> some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Image(systemName: s.needsYou > 0 ? "hand.raised.fill" : "circle.dotted")
                Text("\(s.needsYou > 0 ? s.needsYou : s.working)").font(.headline.monospacedDigit())
            }
        }
        .accessibilityLabel(summary(s))
    }

    private func rectangular(_ s: WidgetSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(s.computerName).font(.headline).lineLimit(1)
            Text(summary(s)).font(.caption).lineLimit(1)
            if let first = s.items.first { Text(first.title).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func small(_ s: WidgetSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            header(s)
            Spacer(minLength: 0)
            count(s.needsYou, label: s.needsYou == 1 ? String(localized: "needs you") : String(localized: "need you"), tint: s.needsYou > 0 ? Color("Attention") : .secondary)
            count(s.working, label: String(localized: "working"), tint: .secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetURL(s.items.first(where: \.needsYou).flatMap { threadURL($0.id) })
    }

    private func medium(_ s: WidgetSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                header(s)
                Spacer()
                Text(summary(s)).font(.caption).foregroundStyle(.secondary)
            }
            if s.items.isEmpty {
                Spacer()
                Text("Nothing running.").font(.subheadline).foregroundStyle(.secondary)
                Spacer()
            } else {
                ForEach(s.items.prefix(3)) { item in
                    Link(destination: threadURL(item.id) ?? URL(string: "capsule://")!) {
                        HStack(spacing: 8) {
                            Image(systemName: item.needsYou ? "hand.raised.fill" : "circle.dotted")
                                .foregroundStyle(item.needsYou ? Color("Attention") : .secondary)
                                .frame(width: 16)
                            Text(item.title).font(.subheadline).lineLimit(1)
                            Spacer(minLength: 4)
                            Text(item.project).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }

    private func header(_ s: WidgetSnapshot) -> some View {
        HStack(spacing: 6) {
            Image("Mark").resizable().scaledToFit().frame(width: 16, height: 16).foregroundStyle(.primary)
            Text(s.computerName).font(.caption.weight(.semibold)).lineLimit(1)
            if !s.connected {
                Image(systemName: "wifi.slash").font(.caption2).foregroundStyle(.secondary).accessibilityLabel("Offline")
            }
        }
    }

    private func count(_ n: Int, label: String, tint: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text("\(n)").font(.title2.weight(.semibold).monospacedDigit()).foregroundStyle(tint)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
    }

    private func summary(_ s: WidgetSnapshot) -> String {
        if s.needsYou > 0 { return String(localized: "\(s.needsYou) need you") }
        if s.working > 0 { return String(localized: "\(s.working) working") }
        return String(localized: "All quiet")
    }
}

#Preview("Small", as: .systemSmall) { StatusWidget() } timeline: { StatusEntry(date: .now, snapshot: .placeholder) }
#Preview("Medium", as: .systemMedium) { StatusWidget() } timeline: { StatusEntry(date: .now, snapshot: .placeholder) }
#Preview("Approval", as: .content, using: CapsuleActivityAttributes(threadID: "t", threadTitle: "Fix the flaky date tests", projectName: "weather-app")) {
    TurnActivity()
} contentStates: {
    CapsuleActivityAttributes.ContentState(phase: .approval, step: nil, startedAt: .now - 95, finishedAt: nil, approvalID: "a",
                                           approvalAction: "Run a command", approvalDetail: "npm test -- --runInBand")
    CapsuleActivityAttributes.ContentState(phase: .working, step: "Running npm test", startedAt: .now - 42, finishedAt: nil)
}
