import SwiftUI

/*
 * A decision an agent is waiting on.
 *
 * Allow once, or (over a pinned phone pairing) allow for the rest of this
 * thread's agent session — standing permissions are still changed on the
 * computer. A decision is sent exactly once: if the connection drops before
 * the answer comes back, the card says so and re-enables, leaving it to the
 * user to check rather than resending.
 */
struct ApprovalCard: View {
    @Environment(Workspace.self) private var workspace
    let approval: Approval
    /// False once the run that asked has ended; the request can't be answered.
    let runIsLive: Bool
    @State private var sending: Workspace.Decision?
    @State private var error: String?
    @State private var showFull = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                IconTile(symbol: symbol, tint: runIsLive ? .attention : .textMuted, size: 30,
                         background: runIsLive ? .attentionBackground : .subtle)
                VStack(alignment: .leading, spacing: 2) {
                    Text(approval.action)
                        .font(.headline)
                        .foregroundStyle(Color.textPrimary)
                    HStack(spacing: 5) {
                        if let harness = Harness(approval.agentId) ?? Harness(name: approval.agentName) { HarnessMark(harness, size: 14) }
                        Text(approval.agentName.map { String(localized: "\($0) is waiting for you") } ?? String(localized: "An agent is waiting for you"))
                    }
                    .font(.subheadline)
                    .foregroundStyle(Color.textMuted)
                }
            }
            if let detail {
                Button {
                    showFull.toggle()
                } label: {
                    Text(detail)
                        .font(.footnote.monospaced())
                        .foregroundStyle(Color.textPrimary)
                        .lineLimit(showFull ? nil : 4)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(Color.codeBackground, in: .rect(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .textSelection(.enabled)
                .accessibilityHint(Text(showFull ? "Shows less." : "Shows the whole command."))
            }
            if !approval.reason.isEmpty {
                Text(approval.reason)
                    .font(.footnote)
                    .foregroundStyle(Color.textSecondary)
            }
            Label {
                Text(approval.target).lineLimit(1).truncationMode(.head)
            } icon: {
                Image(systemName: "folder")
            }
            .font(.caption)
            .foregroundStyle(Color.textTertiary)

            if let error {
                Text(error).font(.footnote).foregroundStyle(Color.failure)
            }
            if !runIsLive {
                Label("This turn ended before it was answered.", systemImage: "clock.badge.xmark")
                    .font(.footnote)
                    .foregroundStyle(Color.textMuted)
            } else if workspace.canControl {
                actions
            } else {
                Label("Answer this on your computer. This device can read but not approve.", systemImage: "eye")
                    .font(.footnote)
                    .foregroundStyle(Color.textMuted)
            }
        }
        .padding(14)
        .background(Color.card, in: .rect(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous)
            .strokeBorder(runIsLive ? Color.attention.opacity(0.35) : Color.hairline, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Approval needed: \(approval.action)"))
        .accessibilityActions {
            if runIsLive && workspace.canControl && sending == nil {
                Button("Allow once") { decide(.once) }
                Button("Deny") { decide(.deny) }
                Button("Deny and reply") { denyAndReply() }
                if workspace.canAllowForThread { Button("Allow for this thread") { decide(.thread) } }
            }
        }
    }

    private var actions: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                DecisionButton(title: "Deny", busy: sending == .deny, prominent: false) { decide(.deny) }
                DecisionButton(title: "Allow once", busy: sending == .once, prominent: true) { decide(.once) }
            }
            HStack(spacing: 0) {
                // Say no and steer: the agent hears why from your next message.
                Button { denyAndReply() } label: {
                    Text("Deny and reply").frame(maxWidth: .infinity, minHeight: 36)
                }
                .accessibilityHint(Text("Denies this request, then lets you tell the agent what to do instead."))
                if workspace.canAllowForThread {
                    Rectangle().fill(Color.hairline).frame(width: 1, height: 18)
                    Button { decide(.thread) } label: {
                        HStack(spacing: 6) {
                            if sending == .thread { ProgressView().controlSize(.small) }
                            Text("Allow for this thread")
                        }
                        .frame(maxWidth: .infinity, minHeight: 36)
                    }
                    .accessibilityHint(Text("Allows this kind of request until the agent session ends."))
                }
            }
            .buttonStyle(.plain)
            .font(.subheadline.weight(.medium))
            .foregroundStyle(Color.textSecondary)
        }
        .disabled(sending != nil)
    }

    private var kind: String? { approval.details?["kind"]?.string }

    private var symbol: String {
        switch kind {
        case "execute": "apple.terminal"
        case "edit", "delete", "move": "pencil.line"
        case "fetch": "globe"
        default: "hand.raised.fill"
        }
    }

    private var detail: String? { approval.subject }

    /// Denies, then opens the message box for what to do instead.
    private func denyAndReply() {
        let threadID = workspace.latestRuns.first { $0.value.id == approval.runId }?.key
        decide(.deny)
        if let threadID { workspace.pendingInsert = (threadID, "") }
    }

    private func decide(_ decision: Workspace.Decision) {
        sending = decision
        Haptics.tap()
        Task {
            do {
                try await workspace.resolve(approval, decision)
                Haptics.success()
            } catch {
                self.error = error.localizedDescription
                sending = nil
                Haptics.warning()
            }
        }
    }
}

private struct DecisionButton: View {
    let title: LocalizedStringKey
    let busy: Bool
    let prominent: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Text(title).opacity(busy ? 0 : 1)
                if busy { ProgressView().tint(prominent ? Color.primaryText : Color.textPrimary) }
            }
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(prominent ? Color.primaryFill : Color.subtle, in: .capsule)
            // A hairline keeps the quiet choice a button without competing with the filled one.
            .overlay { if !prominent { Capsule().strokeBorder(Color.hairline) } }
            .foregroundStyle(prominent ? Color.primaryText : Color.textPrimary)
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
    }
}
