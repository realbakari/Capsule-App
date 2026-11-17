import SwiftUI

/*
 * A decision an agent is waiting on.
 *
 * One line says who wants what; the command or file follows, then where.
 * Allow once, or (over a pinned phone pairing, on a thread whose agent keeps
 * the answer) allow for the rest of this thread's agent session. Choices the
 * computer would refuse aren't offered. Standing permissions are still
 * changed on the computer. A decision is sent exactly once: if the
 * connection drops before the answer comes back, the card says so and
 * re-enables, leaving it to the user to check rather than resending.
 */
struct ApprovalCard: View {
    @Environment(Workspace.self) private var workspace
    let approval: Approval
    /// False once the run that asked has ended; the request can't be answered.
    let runIsLive: Bool
    @State private var sending: Workspace.Decision?
    @State private var error: String?
    @State private var showFull = false

    /// "Claude wants to run a command"
    static func headline(_ approval: Approval) -> String {
        let who = approval.agentName ?? String(localized: "The agent")
        return "\(who) \(String(localized: "wants to")) \(ApprovalWording.verbPhrase(approval.action))"
    }

    /// The reason, unless it only repeats the action.
    static func reason(_ approval: Approval) -> String? {
        let reason = approval.reason.trimmingCharacters(in: .whitespacesAndNewlines)
        let action = approval.action.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reason.isEmpty, reason.caseInsensitiveCompare(action) != .orderedSame,
              reason.trimmingCharacters(in: CharacterSet(charactersIn: ".")).caseInsensitiveCompare(action) != .orderedSame else { return nil }
        return reason
    }

    private var offersThread: Bool { workspace.offersAllowForThread(approval) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 8) {
                IconTile(symbol: symbol, tint: runIsLive ? .attention : .textMuted, size: 26,
                         background: runIsLive ? .attentionBackground : .subtle)
                if let harness = Harness(approval.agentId) ?? Harness(name: approval.agentName) { HarnessMark(harness, size: 14) }
                Text(Self.headline(approval))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.textPrimary)
                    .lineLimit(2)
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
            if !approval.target.isEmpty {
                Label {
                    Text(approval.target).lineLimit(1).truncationMode(.head)
                } icon: {
                    Image(systemName: "folder")
                }
                .font(.caption)
                .foregroundStyle(Color.textTertiary)
            }
            if let reason = Self.reason(approval) {
                Text(reason)
                    .font(.footnote)
                    .foregroundStyle(Color.textSecondary)
            }

            if let error {
                Text(error).font(.footnote).foregroundStyle(Color.failure)
            }
            if !runIsLive {
                Label("This turn ended before it was answered.", systemImage: "clock.badge.xmark")
                    .font(.footnote)
                    .foregroundStyle(Color.textMuted)
            } else if workspace.mayControl {
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
        .accessibilityLabel(Text("Approval needed: \(Self.headline(approval))"))
        .accessibilityActions {
            if runIsLive && workspace.canControl && sending == nil {
                if approval.canApproveOnce { Button("Allow once") { decide(.once) } }
                Button("Deny") { decide(.deny) }
                Button("Deny and reply") { denyAndReply() }
                if offersThread { Button("Allow for this thread") { decide(.thread) } }
            }
        }
    }

    private var actions: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                DecisionButton(title: "Deny", busy: sending == .deny, prominent: false) { decide(.deny) }
                DecisionButton(title: "Allow once", busy: sending == .once, prominent: approval.canApproveOnce) { decide(.once) }
                    .disabled(!approval.canApproveOnce)
                    .opacity(approval.canApproveOnce ? 1 : 0.5)
            }
            if !approval.canApproveOnce {
                Text("This agent didn't offer Allow once. Deny, or change the agent's settings on your computer.")
                    .font(.footnote)
                    .foregroundStyle(Color.textMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(spacing: 0) {
                // Say no and steer: the agent hears why from your next message.
                Button { denyAndReply() } label: {
                    Text("Deny and reply").frame(maxWidth: .infinity, minHeight: 36)
                }
                .accessibilityHint(Text("Denies this request, then lets you tell the agent what to do instead."))
                if offersThread {
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
            if !workspace.isConnected {
                Label("Waiting for your computer…", systemImage: "bolt.horizontal")
                    .font(.footnote)
                    .foregroundStyle(Color.textMuted)
            }
        }
        .disabled(sending != nil || !workspace.canControl)
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
