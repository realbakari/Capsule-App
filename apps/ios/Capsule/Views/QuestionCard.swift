import SwiftUI

/*
 * A question the agent stopped to ask, answered with its own choices.
 *
 * One question at a time, with progress when there are several. A single
 * choice and a typed answer replace each other; several choices and a typed
 * one go together. "Don't answer" lets the agent carry on with its own
 * judgement. An answer is sent once: if it can't be confirmed, the card
 * says so and leaves the choice to the user rather than resending.
 */
struct QuestionCard: View {
    @Environment(Workspace.self) private var workspace
    let approval: Approval
    /// False once the run that asked has ended; the question can't be answered.
    let runIsLive: Bool
    @State private var index = 0
    @State private var drafts: [String: Draft] = [:]
    @State private var busy = false
    @State private var error: String?
    @FocusState private var typing: Bool

    struct Draft: Equatable {
        var picked: [String] = []
        var other = ""
        var isAnswered: Bool { !picked.isEmpty || !other.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    /// Question id to the chosen labels and any typed answer, in the order the computer checks them.
    static func answers(_ questions: [AgentQuestion], _ drafts: [String: Draft]) -> [String: [String]] {
        Dictionary(uniqueKeysWithValues: questions.map { question in
            let draft = drafts[question.id] ?? Draft()
            let other = draft.other.trimmingCharacters(in: .whitespacesAndNewlines)
            let values = question.multiSelect ? draft.picked + (other.isEmpty ? [] : [other])
                : other.isEmpty ? Array(draft.picked.prefix(1)) : [other]
            return (question.id, values)
        })
    }

    private var questions: [AgentQuestion] { approval.questions }

    var body: some View {
        let questions = questions
        if questions.indices.contains(index) {
            let question = questions[index]
            VStack(alignment: .leading, spacing: 12) {
                header(count: questions.count)
                if let tag = question.header {
                    Text(tag)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.textSecondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.subtle, in: .capsule)
                }
                Text(question.question)
                    .font(.headline)
                    .foregroundStyle(Color.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                if !question.options.isEmpty { options(question) }
                if question.allowOther { otherField(question) }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(Color.failure)
                }
                footer(question: question, last: index == questions.count - 1)
            }
            .padding(14)
            .background(Color.card, in: .rect(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(runIsLive ? Color.attention.opacity(0.35) : Color.hairline, lineWidth: 1))
            .accessibilityElement(children: .contain)
            .onChange(of: approval.id) { index = 0; drafts = [:]; error = nil }
        }
    }

    private var answerable: Bool { runIsLive && workspace.mayControl && !busy }

    private func header(count: Int) -> some View {
        HStack(spacing: 6) {
            if let harness = Harness(approval.agentId) ?? Harness(name: approval.agentName) { HarnessMark(harness, size: 14) }
            Text(approval.agentName.map { String(localized: "\($0) asks") } ?? String(localized: "The agent asks"))
            Spacer(minLength: 0)
            if count > 1 {
                Text("\(index + 1) of \(count)").monospacedDigit()
            }
        }
        .font(.subheadline)
        .foregroundStyle(Color.textMuted)
    }

    private func options(_ question: AgentQuestion) -> some View {
        let draft = drafts[question.id] ?? Draft()
        return VStack(spacing: 6) {
            ForEach(question.options, id: \.label) { option in
                let selected = draft.picked.contains(option.label)
                Button { toggle(option.label, in: question) } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Image(systemName: question.multiSelect ? (selected ? "checkmark.square.fill" : "square")
                                                               : (selected ? "largecircle.fill.circle" : "circle"))
                            .foregroundStyle(selected ? Color.textPrimary : Color.textTertiary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(option.label).font(.body.weight(.medium)).foregroundStyle(Color.textPrimary)
                            if let detail = option.description {
                                Text(detail).font(.footnote).foregroundStyle(Color.textMuted)
                            }
                        }
                        .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(selected ? Color.subtleStrong : Color.subtle, in: .rect(cornerRadius: 12, style: .continuous))
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .disabled(!answerable)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
    }

    @ViewBuilder private func otherField(_ question: AgentQuestion) -> some View {
        let prompt = question.options.isEmpty
            ? (question.secret ? String(localized: "Type the answer; it isn't kept in the thread") : String(localized: "Type your answer"))
            : String(localized: "Or type your own answer")
        let text = Binding<String>(
            get: { drafts[question.id]?.other ?? "" },
            set: { value in
                error = nil
                var draft = drafts[question.id] ?? Draft()
                draft.other = value
                // A typed answer replaces a single choice.
                if !question.multiSelect, !value.trimmingCharacters(in: .whitespaces).isEmpty { draft.picked = [] }
                drafts[question.id] = draft
            })
        Group {
            if question.secret {
                SecureField(prompt, text: text)
            } else {
                TextField(prompt, text: text, axis: .vertical).lineLimit(1...5)
            }
        }
        .focused($typing)
        .textInputAutocapitalization(question.secret ? .never : .sentences)
        .autocorrectionDisabled(question.secret)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.subtle, in: .rect(cornerRadius: 12, style: .continuous))
        .disabled(!answerable)
    }

    @ViewBuilder private func footer(question: AgentQuestion, last: Bool) -> some View {
        if !runIsLive {
            Label("This turn ended before it was answered.", systemImage: "clock.badge.xmark")
                .font(.footnote).foregroundStyle(Color.textMuted)
        } else if !workspace.mayControl {
            Label("Answer this on your computer. This device can read but not answer.", systemImage: "eye")
                .font(.footnote).foregroundStyle(Color.textMuted)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    if index > 0 {
                        Button("Back") { error = nil; index -= 1 }
                            .buttonStyle(.bordered).buttonBorderShape(.capsule)
                    }
                    Button {
                        advance(question: question, last: last)
                    } label: {
                        ZStack {
                            Text(last ? "Send answer" : "Next").opacity(busy ? 0 : 1)
                            if busy { ProgressView().tint(Color.primaryText) }
                        }
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(Color.primaryFill, in: .capsule)
                        .foregroundStyle(Color.primaryText)
                    }
                    .buttonStyle(.plain)
                    .disabled(busy || (last && !workspace.canControl))
                }
                HStack {
                    Button("Don't answer") { decline() }
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.textSecondary)
                        .buttonStyle(.plain)
                        .disabled(busy || !workspace.canControl)
                        .accessibilityHint(Text("The agent continues with its own judgement."))
                    Spacer()
                    if !workspace.isConnected {
                        Text("Waiting for your computer…").font(.footnote).foregroundStyle(Color.textMuted)
                    }
                }
            }
        }
    }

    private func toggle(_ label: String, in question: AgentQuestion) {
        Haptics.selection()
        error = nil
        var draft = drafts[question.id] ?? Draft()
        if question.multiSelect {
            if let at = draft.picked.firstIndex(of: label) { draft.picked.remove(at: at) } else { draft.picked.append(label) }
        } else {
            draft.picked = [label]
            draft.other = ""
        }
        drafts[question.id] = draft
    }

    private func advance(question: AgentQuestion, last: Bool) {
        guard drafts[question.id]?.isAnswered == true else {
            error = String(localized: "Choose an answer, or type one.")
            return
        }
        typing = false
        error = nil
        if last { submit() } else { index += 1 }
    }

    private func submit() {
        if let missing = questions.firstIndex(where: { drafts[$0.id]?.isAnswered != true }) {
            index = missing
            error = String(localized: "Answer this question to continue.")
            return
        }
        busy = true
        Haptics.tap()
        Task {
            defer { busy = false }
            do {
                try await workspace.answer(approval, Self.answers(questions, drafts))
                Haptics.success()
            } catch {
                self.error = error.localizedDescription
                Haptics.warning()
            }
        }
    }

    private func decline() {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await workspace.resolve(approval, .deny)
            } catch {
                self.error = error.localizedDescription
                Haptics.warning()
            }
        }
    }
}
