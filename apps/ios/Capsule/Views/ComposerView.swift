import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/*
 * The message box, floating over the transcript. With a control pairing it
 * sends; while a turn runs, a strip above the field says what the agent is
 * doing and for how long, with Stop beside it — the computer runs one turn
 * per thread, so the send button waits. Without control it says so plainly
 * instead of offering a box that would fail. Drafts are kept per thread.
 */
struct ComposerView: View {
    @Environment(Workspace.self) private var workspace
    let model: ThreadModel
    @State private var text = ""
    @State private var sending = false
    @State private var stopping = false
    @State private var error: String?
    @State private var mode: ThreadMode?
    @State private var skill: SkillInfo?
    @State private var skills: [SkillInfo] = []
    @State private var attachments: [PendingAttachment] = []
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showPhotos = false
    @State private var showCamera = false
    @State private var showFiles = false
    @State private var dictation = Dictation()
    /// The draft as it was when dictation started; heard words go after it.
    @State private var dictationBase = ""
    @State private var commands: [AgentCommandInfo] = []
    @FocusState private var focused: Bool

    private var draftKey: String { "draft.\(model.threadID)" }

    /// The agent this thread talks to; its mark sits in the composer.
    private var harness: Harness? {
        workspace.thread(model.threadID).flatMap { Harness($0.harnessId ?? $0.agentId) }
    }

    private var threadMode: ThreadMode? {
        workspace.thread(model.threadID)?.mode.flatMap(ThreadMode.init(rawValue:))
    }

    /// Text after a leading "/", which searches skills instead of being sent.
    private var skillQuery: String? {
        guard text.hasPrefix("/"), !text.contains(" "), !text.contains("\n") else { return nil }
        return String(text.dropFirst())
    }

    private func matchingSkills(_ query: String) -> [SkillInfo] {
        let q = query.lowercased()
        // Name starts with it, then a word in the name does, then anywhere.
        func rank(_ skill: SkillInfo) -> Int? {
            let name = skill.name.lowercased()
            if q.isEmpty || name.hasPrefix(q) { return 0 }
            if name.split(whereSeparator: { !$0.isLetter && !$0.isNumber }).contains(where: { $0.hasPrefix(q) }) { return 1 }
            if name.contains(q) || skill.id.lowercased().contains(q) { return 2 }
            return nil
        }
        return Array(skills.compactMap { skill in rank(skill).map { (skill, $0) } }
            .sorted { $0.1 < $1.1 }
            .map(\.0)
            .prefix(6))
    }

    /// The agent's own commands that start with what follows "/".
    private func matchingCommands(_ query: String) -> [AgentCommandInfo] {
        let q = query.lowercased()
        return Array(commands.filter { q.isEmpty || $0.name.lowercased().hasPrefix(q) }.prefix(6))
    }
    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(spacing: 8) {
            if let error {
                ErrorStrip(message: error) { self.error = nil }
            }
            if workspace.canControl {
                VStack(spacing: 0) {
                    if let live = model.liveRun { workingStrip(live) }
                    if !model.followUps.queue.isEmpty {
                        QueueStrip(model: model, error: $error)
                    }
                    if let query = skillQuery, !matchingSkills(query).isEmpty || !matchingCommands(query).isEmpty {
                        SkillSuggestions(skills: matchingSkills(query), commands: matchingCommands(query)) { picked in
                            skill = picked
                            text = ""
                            Haptics.selection()
                        } pickCommand: { command in
                            // The command goes in the message itself; the agent runs it when it's sent.
                            text = "/\(command.name) "
                            focused = true
                            Haptics.selection()
                        }
                    }
                    if !attachments.isEmpty {
                        PendingStrip(items: $attachments)
                    }
                    field
                    ComposerControls(mode: $mode, skill: $skill, skills: skills, threadMode: threadMode, harness: harness,
                                     attach: workspace.canAttach ? { kind in
                                         switch kind {
                                         case .photos: showPhotos = true
                                         case .camera: showCamera = true
                                         case .file: showFiles = true
                                         }
                                     } : nil)
                }
                .glassSurface(cornerRadius: 24)
            } else {
                readOnly
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
        .frame(maxWidth: 760)
        .frame(maxWidth: .infinity)
        .animation(.snappy(duration: 0.25), value: model.liveRun?.id)
        .animation(.snappy(duration: 0.25), value: model.followUps.queue.count)
        .animation(.snappy(duration: 0.25), value: error)
        .onAppear { text = UserDefaults.standard.string(forKey: draftKey) ?? "" }
        .onChange(of: workspace.pendingInsert?.text) { _, _ in
            // "Ask about this file" from the project view: add to the draft, never send.
            guard let insert = workspace.pendingInsert, insert.threadID == model.threadID else { return }
            workspace.pendingInsert = nil
            // An empty insert only focuses the box (after "Deny and reply").
            if !insert.text.isEmpty {
                text = text.isEmpty ? insert.text : text + (text.hasSuffix(" ") ? "" : " ") + insert.text
            }
            focused = true
        }
        .photosPicker(isPresented: $showPhotos, selection: $photoItems, maxSelectionCount: 4, matching: .images)
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            photoItems = []
            for item in items {
                Task {
                    guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else { return }
                    await attachImage(image)
                }
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in Task { await attachImage(image) } }.ignoresSafeArea()
        }
        .fileImporter(isPresented: $showFiles, allowedContentTypes: [.plainText, .json, UTType(filenameExtension: "md") ?? .plainText],
                      allowsMultipleSelection: false) { result in
            guard case .success(let urls) = result, let url = urls.first else { return }
            Task { await attachFile(url) }
        }
        .task(id: workspace.isConnected) {
            guard workspace.canControl, let projectID = workspace.thread(model.threadID)?.projectId else { return }
            skills = await workspace.skills(projectID: projectID, threadID: model.threadID)
            commands = await workspace.agentCommands(threadID: model.threadID)
        }
        .onChange(of: dictation.transcript) { _, heard in
            guard dictation.isActive || !heard.isEmpty else { return }
            text = dictationBase.isEmpty ? heard : dictationBase + (dictationBase.hasSuffix(" ") || dictationBase.hasSuffix("\n") ? "" : " ") + heard
        }
        .onDisappear { if dictation.isActive { Task { await dictation.stop() } } }
        .onChange(of: text) { _, value in
            UserDefaults.standard.set(value.isEmpty ? nil : value, forKey: draftKey)
        }
    }

    private var field: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField(harness.map { String(localized: "Reply to \($0.name)") } ?? String(localized: "Reply"), text: $text, axis: .vertical)
                .font(.body)
                .lineLimit(1...8)
                .focused($focused)
                .padding(.leading, 16)
                .padding(.vertical, 12)
                .accessibilityLabel(Text("Message"))
            if dictation.isActive {
                DictationMeter(level: dictation.level, preparing: dictation.state == .preparing)
                    .padding(.bottom, 14)
                Button {
                    dictation.cancel()
                    text = dictationBase
                } label: {
                    Image(systemName: "xmark").font(.footnote.weight(.bold)).frame(width: 34, height: 34)
                        .foregroundStyle(Color.textSecondary).background(Color.subtle, in: .circle)
                }
                .buttonStyle(.plain)
                .padding(.bottom, 7)
                .accessibilityLabel(Text("Discard dictation"))
                Button {
                    Task { await dictation.stop(); focused = true }
                } label: {
                    Image(systemName: "checkmark").font(.footnote.weight(.bold)).frame(width: 34, height: 34)
                        .foregroundStyle(Color.primaryText).background(Color.primaryFill, in: .circle)
                }
                .buttonStyle(.plain)
                .padding(.trailing, 7)
                .padding(.bottom, 7)
                .accessibilityLabel(Text("Done dictating"))
            } else {
            Button {
                dictationBase = text
                focused = false
                Task {
                    await dictation.start()
                    if case .failed(let message) = dictation.state { error = message }
                }
            } label: {
                Image(systemName: "mic").font(.body.weight(.medium)).frame(width: 34, height: 34)
                    .foregroundStyle(Color.textSecondary)
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .padding(.bottom, 7)
            .accessibilityLabel(Text("Dictate"))
            .accessibilityHint(Text("Transcribed on this device. The words go in the message box; nothing is sent."))
            Button {
                Task { await send() }
            } label: {
                Group {
                    if sending { ProgressView().tint(Color.primaryText) }
                    else {
                        Image(systemName: queues ? "text.badge.plus" : "arrow.up")
                            .font(.body.weight(.bold))
                            .contentTransition(.symbolEffect(.replace))
                    }
                }
                .frame(width: 34, height: 34)
                .foregroundStyle(canSend ? Color.primaryText : Color.textTertiary)
                .background(canSend ? Color.primaryFill : Color.subtleStrong, in: .circle)
            }
            .buttonStyle(.plain)
            .hoverEffect(.lift)
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(!canSend)
            .padding(.trailing, 7)
            .padding(.bottom, 7)
            .accessibilityLabel(queues ? Text("Queue") : Text("Send"))
            .accessibilityHint(queues ? Text("Sends after the current turn finishes.") : Text(""))
            }
        }
    }

    /// While a turn runs, the button queues the message behind it instead.
    private var queues: Bool { model.liveRun != nil }
    private var canSend: Bool {
        (!trimmed.isEmpty || attachments.contains { $0.uploaded != nil }) && !sending && !attachments.contains { $0.uploaded == nil && $0.error == nil }
    }

    private var readyAttachments: [MessageAttachment] { attachments.compactMap(\.uploaded) }

    /// Photos go up as JPEG at most 2048 px on the long side.
    private func attachImage(_ image: UIImage) async {
        let scaled = image.scaledDown(toLongSide: 2048)
        guard let data = scaled.jpegData(compressionQuality: 0.8) else { return }
        let name = "Photo \(Date.now.formatted(.dateTime.hour().minute().second())).jpg"
        await upload(data, name: name, mimeType: "image/jpeg", preview: scaled.scaledDown(toLongSide: 240))
    }

    private func attachFile(_ url: URL) async {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { error = String(localized: "Couldn't read that file."); return }
        let mime = url.pathExtension.lowercased() == "json" ? "application/json" : url.pathExtension.lowercased() == "md" ? "text/markdown" : "text/plain"
        await upload(data, name: url.lastPathComponent, mimeType: mime, preview: nil)
    }

    private func upload(_ data: Data, name: String, mimeType: String, preview: UIImage?) async {
        guard data.count <= 3 * 1024 * 1024 else { error = String(localized: "That file is over 3 MB."); return }
        let pending = PendingAttachment(name: name, preview: preview)
        attachments.append(pending)
        do {
            let stored = try await workspace.upload(data, name: name, mimeType: mimeType, threadID: model.threadID)
            if let index = attachments.firstIndex(where: { $0.id == pending.id }) { attachments[index].uploaded = stored }
        } catch {
            if let index = attachments.firstIndex(where: { $0.id == pending.id }) { attachments[index].error = error.localizedDescription }
        }
    }

    private func workingStrip(_ run: Run) -> some View {
        HStack(spacing: 8) {
            WorkingPulse().foregroundStyle(run.status == .approvalRequired ? Color.attention : Color.textSecondary)
            TimelineView(.periodic(from: .now, by: 1)) { _ in
                HStack(spacing: 6) {
                    Text(run.status == .approvalRequired ? String(localized: "Waiting for your approval") : String(localized: "Working"))
                        .foregroundStyle(Color.textSecondary)
                    if let elapsed = Self.elapsed(since: run.createdAt) {
                        Text(elapsed).foregroundStyle(Color.textTertiary)
                    }
                }
            }
            .font(.subheadline.weight(.medium).monospacedDigit())
            Spacer()
            Button {
                Task { await stop(run) }
            } label: {
                HStack(spacing: 5) {
                    if stopping { ProgressView().controlSize(.mini) } else { Image(systemName: "stop.fill").font(.caption2).imageScale(.small) }
                    Text("Stop")
                }
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Color.subtleStrong, in: .capsule)
                .contentShape(.capsule)
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .keyboardShortcut(".", modifiers: .command)
            .foregroundStyle(Color.textPrimary)
            .disabled(stopping)
            .accessibilityLabel(Text("Stop the running turn"))
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .padding(.top, 8)
        .padding(.bottom, 2)
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .accessibilityElement(children: .contain)
    }

    private var readOnly: some View {
        HStack(spacing: 10) {
            Image(systemName: workspace.isConnected ? "eye" : "bolt.horizontal")
                .foregroundStyle(Color.textMuted)
            Text(workspace.isConnected
                 ? "Read only. Pair with a phone code to send messages and approve."
                 : "You can reply once your computer is connected.")
                .font(.footnote)
                .foregroundStyle(Color.textMuted)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .glassSurface(cornerRadius: 20)
        .accessibilityElement(children: .combine)
    }

    static func elapsed(since timestamp: String) -> String? {
        guard let start = Timestamp.date(timestamp) else { return nil }
        let seconds = max(0, Int(Date.now.timeIntervalSince(start)))
        return seconds < 3600 ? String(format: "%d:%02d", seconds / 60, seconds % 60)
            : String(format: "%d:%02d:%02d", seconds / 3600, (seconds % 3600) / 60, seconds % 60)
    }

    private func send() async {
        let message = trimmed
        guard !message.isEmpty || !readyAttachments.isEmpty else { return }
        sending = true
        defer { sending = false }
        do {
            if queues {
                try await workspace.queue(message, in: model, attachments: readyAttachments)
            } else {
                try await workspace.send(message, to: model, mode: mode, skillID: skill?.id, attachments: readyAttachments)
                skill = nil
            }
            attachments = []
            text = ""
            error = nil
            Haptics.success()
        } catch {
            // The text stays in the box: nothing is lost, and nothing is resent behind the user's back.
            self.error = error.localizedDescription
            Haptics.warning()
        }
    }

    private func stop(_ run: Run) async {
        stopping = true
        defer { stopping = false }
        do {
            try await workspace.stop(run)
            Haptics.success()
        } catch {
            self.error = error.localizedDescription
            Haptics.warning()
        }
    }
}

private struct ErrorStrip: View {
    let message: String
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Color.failure)
            Text(message).font(.footnote).foregroundStyle(Color.textPrimary)
            Spacer(minLength: 4)
            Button(action: dismiss) {
                Image(systemName: "xmark").font(.caption.weight(.semibold)).foregroundStyle(Color.textMuted)
                    .frame(width: 24, height: 24).contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Dismiss"))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color.failureBackground, in: .rect(cornerRadius: 16, style: .continuous))
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}

extension View {
    /// Liquid Glass; iOS 26 is the minimum, so there is no fallback branch.
    func glassSurface(cornerRadius: CGFloat) -> some View {
        glassEffect(.regular.interactive(), in: .rect(cornerRadius: cornerRadius, style: .continuous))
    }
}

/// Messages waiting behind the running turn, in the order they'll be sent.
private struct QueueStrip: View {
    @Environment(Workspace.self) private var workspace
    let model: ThreadModel
    @Binding var error: String?
    @State private var expanded = false

    var body: some View {
        let queue = model.followUps.queue
        VStack(alignment: .leading, spacing: 6) {
            Button {
                Haptics.selection()
                expanded.toggle()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "text.line.first.and.arrowtriangle.forward").font(.caption)
                    Text(queue.count == 1 ? String(localized: "1 queued") : String(localized: "\(queue.count) queued"))
                        .font(.subheadline.weight(.medium))
                    if let blocked = model.followUps.blocked {
                        Text(blocked).font(.caption).foregroundStyle(Color.attention).lineLimit(1)
                    }
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.caption2.weight(.semibold))
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .foregroundStyle(Color.textSecondary)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint(Text(expanded ? "Hides the queued messages." : "Shows the queued messages."))
            if expanded {
                ForEach(Array(queue.enumerated()), id: \.element.id) { index, item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("\(index + 1)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(Color.textTertiary)
                        Text(item.content)
                            .font(.subheadline)
                            .foregroundStyle(Color.textPrimary)
                            .lineLimit(2)
                        Spacer(minLength: 4)
                        Menu {
                            if index > 0 { Button("Move up", systemImage: "arrow.up") { run { try await workspace.moveQueued(item.id, up: true, in: model) } } }
                            if index < queue.count - 1 { Button("Move down", systemImage: "arrow.down") { run { try await workspace.moveQueued(item.id, up: false, in: model) } } }
                            Button("Remove", systemImage: "trash", role: .destructive) { run { try await workspace.removeQueued(item.id, in: model) } }
                        } label: {
                            Image(systemName: "ellipsis")
                                .foregroundStyle(Color.textMuted)
                                .frame(width: 28, height: 24)
                                .contentShape(.rect)
                        }
                        .accessibilityLabel(Text("Options for queued message \(index + 1)"))
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 2)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private func run(_ action: @escaping () async throws -> Void) {
        Task {
            do { try await action(); Haptics.tap() } catch { self.error = error.localizedDescription; Haptics.warning() }
        }
    }
}

/// The row under the message box: how the next turn works.
enum AttachKind { case photos, camera, file }

private struct ComposerControls: View {
    @Binding var mode: ThreadMode?
    @Binding var skill: SkillInfo?
    let skills: [SkillInfo]
    let threadMode: ThreadMode?
    var harness: Harness? = nil
    let attach: ((AttachKind) -> Void)?

    private var shown: ThreadMode { mode ?? threadMode ?? .agent }

    var body: some View {
        HStack(spacing: 8) {
            if let attach {
                Menu {
                    Button("Photo library", systemImage: "photo.on.rectangle") { attach(.photos) }
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button("Take photo", systemImage: "camera") { attach(.camera) }
                    }
                    Button("Text file", systemImage: "doc.text") { attach(.file) }
                } label: {
                    Image(systemName: "plus")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.textSecondary)
                        .frame(width: 30, height: 28)
                        .background(Color.subtle, in: .capsule)
                        .contentShape(.capsule)
                }
                .accessibilityLabel(Text("Attach"))
            }
            Menu {
                Picker("Mode", selection: Binding(get: { shown }, set: { mode = $0; Haptics.selection() })) {
                    ForEach(ThreadMode.allCases) { item in
                        Label {
                            Text(item.title)
                            Text(item.detail)
                        } icon: {
                            Image(systemName: item.symbol)
                        }
                        .tag(item)
                    }
                }
            } label: {
                Chip(symbol: shown.symbol, text: Text(shown.title), active: mode != nil && mode != threadMode)
            }
            .accessibilityLabel(Text("Mode: \(String(localized: shown.title))"))
            if let skill {
                Button { self.skill = nil } label: {
                    Chip(symbol: "wand.and.stars", text: Text(skill.name), active: true, trailing: "xmark")
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Skill: \(skill.name)"))
                .accessibilityHint(Text("Removes the skill."))
            } else if !skills.isEmpty {
                Menu {
                    ForEach(skills) { item in
                        Button { skill = item } label: {
                            Text(item.name)
                            if let detail = item.description { Text(detail) }
                        }
                    }
                } label: {
                    Chip(symbol: "wand.and.stars", text: Text("Skill"), active: false)
                }
                .accessibilityLabel(Text("Add a skill"))
            }
            Spacer(minLength: 0)
            if let harness {
                // Which agent hears this message. A thread keeps its agent, so it's a label, not a control.
                HStack(spacing: 5) {
                    HarnessMark(harness, size: 15)
                    Text(harness.name).font(.caption.weight(.medium)).lineLimit(1)
                }
                .foregroundStyle(Color.textMuted)
                .padding(.trailing, 4)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text("Agent: \(harness.name)"))
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }
}

private struct Chip: View {
    let symbol: String
    let text: Text
    let active: Bool
    var trailing: String? = nil

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: symbol).font(.caption2.weight(.semibold))
            text.font(.caption.weight(.medium)).lineLimit(1)
            if let trailing { Image(systemName: trailing).font(.caption2.weight(.bold)).imageScale(.small) }
        }
        .foregroundStyle(active ? Color.primaryText : Color.textSecondary)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(active ? Color.primaryFill : Color.subtle, in: .capsule)
        .contentShape(.capsule)
    }
}

/// Skills matching what follows "/" in the message box.
private struct SkillSuggestions: View {
    let skills: [SkillInfo]
    let commands: [AgentCommandInfo]
    let pick: (SkillInfo) -> Void
    let pickCommand: (AgentCommandInfo) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(commands) { command in
                Button { pickCommand(command) } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "chevron.left.forwardslash.chevron.right").font(.caption).foregroundStyle(Color.textMuted).frame(width: 18)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(verbatim: "/\(command.name)").font(.subheadline.weight(.medium).monospaced()).foregroundStyle(Color.textPrimary)
                            if !command.description.isEmpty {
                                Text(command.description).font(.caption).foregroundStyle(Color.textMuted).lineLimit(1)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .contentShape(.rect)
                }
                .buttonStyle(RowButtonStyle())
                .accessibilityHint(Text("Agent command. Adds it to the message box."))
            }
            ForEach(skills) { skill in
                Button { pick(skill) } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "wand.and.stars").font(.caption).foregroundStyle(Color.textMuted).frame(width: 18)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(skill.name).font(.subheadline.weight(.medium)).foregroundStyle(Color.textPrimary)
                            if let detail = skill.description {
                                Text(detail).font(.caption).foregroundStyle(Color.textMuted).lineLimit(1)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .contentShape(.rect)
                }
                .buttonStyle(RowButtonStyle())
            }
        }
        .padding(.top, 6)
    }
}

/// A photo or file on its way to the computer, then ready to send.
struct PendingAttachment: Identifiable {
    let id = UUID()
    let name: String
    let preview: UIImage?
    var uploaded: MessageAttachment?
    var error: String?
}

private struct PendingStrip: View {
    @Binding var items: [PendingAttachment]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(items) { item in
                    ZStack(alignment: .topTrailing) {
                        Group {
                            if let preview = item.preview {
                                Image(uiImage: preview).resizable().scaledToFill()
                            } else {
                                VStack(spacing: 4) {
                                    Image(systemName: Icons.file(item.name)).font(.title3)
                                    Text(item.name).font(.caption2).lineLimit(1)
                                }
                                .foregroundStyle(Color.textSecondary)
                                .padding(6)
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                                .background(Color.subtle)
                            }
                        }
                        .frame(width: 64, height: 64)
                        .clipShape(.rect(cornerRadius: 12, style: .continuous))
                        .overlay {
                            if item.uploaded == nil && item.error == nil {
                                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                                    .background(.black.opacity(0.25), in: .rect(cornerRadius: 12))
                            } else if item.error != nil {
                                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Color.failure)
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                                    .background(.black.opacity(0.25), in: .rect(cornerRadius: 12))
                            }
                        }
                        Button {
                            items.removeAll { $0.id == item.id }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, .black.opacity(0.6))
                                .font(.body)
                        }
                        .buttonStyle(.plain)
                        .offset(x: 6, y: -6)
                        .accessibilityLabel(Text("Remove \(item.name)"))
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(Text(item.error ?? item.name))
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
        }
    }
}

/// The camera, for a photo of what's in front of you (a whiteboard, a device).
struct CameraPicker: UIViewControllerRepresentable {
    let onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onImage: onImage, dismiss: { dismiss() }) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onImage: (UIImage) -> Void
        let dismiss: () -> Void
        init(onImage: @escaping (UIImage) -> Void, dismiss: @escaping () -> Void) { self.onImage = onImage; self.dismiss = dismiss }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { onImage(image) }
            dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { dismiss() }
    }
}

extension UIImage {
    func scaledDown(toLongSide limit: CGFloat) -> UIImage {
        let long = max(size.width, size.height)
        guard long > limit else { return self }
        let ratio = limit / long
        let target = CGSize(width: (size.width * ratio).rounded(), height: (size.height * ratio).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
    }
}

/// Five bars that follow the microphone level while dictating.
private struct DictationMeter: View {
    let level: Float
    let preparing: Bool

    var body: some View {
        HStack(spacing: 2.5) {
            ForEach(0..<5) { index in
                let weight: Float = [0.5, 0.8, 1, 0.8, 0.5][index]
                Capsule()
                    .fill(Color.textSecondary)
                    .frame(width: 3, height: preparing ? 4 : CGFloat(4 + 14 * level * weight))
            }
        }
        .frame(height: 18)
        .animation(.easeOut(duration: 0.12), value: level)
        .accessibilityLabel(preparing ? Text("Getting ready to listen") : Text("Listening"))
    }
}
