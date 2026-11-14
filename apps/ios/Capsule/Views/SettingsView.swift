import SwiftUI

struct SettingsView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.dismiss) private var dismiss
    @State private var showPairing = false
    @State private var notificationsOn = true
    @State private var confirmForget: PairedHost?
    @State private var editAddress: PairedHost?
    @State private var approvalsOn = true
    @State private var turns = Notifier.TurnNotifications.all
    @State private var liveActivitiesOn = true
    @AppStorage("display.typeface") private var typeface: String?
    @AppStorage("display.theme") private var theme = AppTheme.system.rawValue

    var body: some View {
        NavigationStack {
            Form {
                Section("Computers") {
                    ForEach(workspace.hosts) { host in
                        NavigationLink {
                            ComputerDetail(host: host, onForget: { confirmForget = host }, onEditAddress: { editAddress = host })
                        } label: {
                            HostRow(host: host, active: host.id == workspace.activeHostID, state: workspace.connectionState)
                        }
                        .swipeActions {
                            Button("Forget", role: .destructive) { confirmForget = host }
                            Button("Address") { editAddress = host }.tint(.gray)
                        }
                        .contextMenu {
                            Button("Edit address", systemImage: "network") { editAddress = host }
                            Button("Forget this computer", systemImage: "trash", role: .destructive) { confirmForget = host }
                        }
                    }
                    Button {
                        showPairing = true
                    } label: {
                        Label("Pair another computer", systemImage: "plus")
                    }
                }

                Section {
                    Picker("Theme", selection: $theme) {
                        ForEach(AppTheme.allCases) { Text($0.title).tag($0.rawValue) }
                    }
                    Picker("Reading text", selection: Binding(get: { ReadingTypeface.stored(typeface) }, set: { typeface = $0.rawValue })) {
                        ForEach(ReadingTypeface.allCases) { Text($0.title).tag($0) }
                    }
                    Toggle("Backdrop from your computer", isOn: Binding(get: { workspace.showsBackdrop }, set: { workspace.showsBackdrop = $0 }))
                        .tint(Color.primaryFill)
                } header: {
                    Text("Display")
                } footer: {
                    Text("Reading text sets how agent replies are set. Code, tables and the rest of the app always use the system font. The backdrop is the scene your computer's theme draws behind conversations; images stay on the computer.")
                }

                if workspace.isConnected {
                    UsageSection()
                }

                Section {
                    Toggle("Notifications", isOn: $notificationsOn)
                        .tint(Color.primaryFill)
                        .onChange(of: notificationsOn) { _, on in
                            workspace.notifier.isEnabled = on
                            if on { Task { await workspace.notifier.requestAuthorizationIfNeeded() } }
                        }
                    if notificationsOn {
                        Toggle("Approvals", isOn: $approvalsOn)
                            .tint(Color.primaryFill)
                            .onChange(of: approvalsOn) { _, on in workspace.notifier.approvalsEnabled = on }
                        Picker("Finished turns", selection: $turns) {
                            Text("All").tag(Notifier.TurnNotifications.all)
                            Text("Only failures").tag(Notifier.TurnNotifications.failures)
                            Text("None").tag(Notifier.TurnNotifications.none)
                        }
                        .onChange(of: turns) { _, value in workspace.notifier.turns = value }
                    }
                } header: {
                    Text("Notifications")
                } footer: {
                    Text("Sent by this device from what it sees while connected, and from occasional background checks. Notifications show thread titles, never message contents.")
                }

                Section {
                    Toggle("Live Activities", isOn: $liveActivitiesOn)
                        .tint(Color.primaryFill)
                        .onChange(of: liveActivitiesOn) { _, on in workspace.liveActivitiesEnabled = on }
                } footer: {
                    Text("A running turn stays on the Lock Screen and in the Dynamic Island, with Allow and Deny when the agent asks. Turns started while Capsule is closed don't get one.")
                }

                Section {
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")
                    if let version = workspace.computerVersion {
                        LabeledContent("Capsule on your computer", value: version)
                    }
                    if workspace.computerNeedsUpdate {
                        Label("Update Capsule on your computer for everything in this app to work.", systemImage: "arrow.down.circle")
                            .font(.footnote)
                            .foregroundStyle(Color.attention)
                    }
                    if let privacy = (Bundle.main.object(forInfoDictionaryKey: "CapsulePrivacyPolicyURL") as? String).flatMap(URL.init(string:)) {
                        Link(destination: privacy) { Label("Privacy policy", systemImage: "hand.raised") }
                    }
                    Button {
                        if workspace.isSample { workspace.endSample() } else { workspace.startSample() }
                        dismiss()
                    } label: {
                        Label(workspace.isSample ? "Leave the sample workspace" : "Try the sample workspace", systemImage: "sparkles.rectangle.stack")
                    }
                } header: {
                    Text("About")
                } footer: {
                    Text("Capsule talks only to the computers you pair. Conversations stay between this device and your computer; nothing is sent to any other server.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.keyboardShortcut(.cancelAction) }
            }
            .sheet(isPresented: $showPairing) { PairingView() }
            .sheet(item: $editAddress) { host in AddressEditor(host: host) }
            .confirmationDialog(
                "Forget this computer?",
                isPresented: Binding(get: { confirmForget != nil }, set: { if !$0 { confirmForget = nil } }),
                titleVisibility: .visible,
                presenting: confirmForget
            ) { host in
                Button("Forget \(host.name)", role: .destructive) {
                    Task { await workspace.forget(host) }
                }
            } message: { _ in
                Text("This device stops connecting and deletes its saved copy. To cut off access on the computer too, choose Revoke under Paired devices there.")
            }
            .onAppear {
                notificationsOn = workspace.notifier.isEnabled
                approvalsOn = workspace.notifier.approvalsEnabled
                turns = workspace.notifier.turns
                liveActivitiesOn = workspace.liveActivitiesEnabled
            }
        }
    }
}

private struct HostRow: View {
    let host: PairedHost
    let active: Bool
    let state: ConnectionState

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "desktopcomputer")
                .font(.title3)
                .foregroundStyle(Color.textMuted)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(host.name).font(.body.weight(.medium))
                Text(host.canControl ? "Can send and approve" : "Read only")
                    .font(.caption).foregroundStyle(Color.textMuted)
                Text(host.securitySummary).font(.caption).foregroundStyle(Color.textMuted)
                Text(verbatim: "\(host.host):\(host.port)").font(.caption.monospaced()).foregroundStyle(Color.textTertiary)
                Text(host.isExpired
                     ? String(localized: "Pairing expired — pair again")
                     : String(localized: "Pairing ends \(host.expiresAt.formatted(.relative(presentation: .named)))"))
                    .font(.caption)
                    .foregroundStyle(host.isExpired ? Color.failure : .secondary)
            }
            Spacer()
            if active {
                Text(statusText).font(.caption.weight(.medium)).foregroundStyle(statusColor)
            }
        }
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    private var statusText: LocalizedStringResource {
        switch state {
        case .ready: "Connected"
        case .connecting: "Connecting"
        case .waiting: "Offline"
        case .unauthorized: "Ended"
        case .idle: "Idle"
        }
    }

    private var statusColor: Color {
        switch state {
        case .ready: .success
        case .unauthorized: .failure
        case .waiting: .attention
        default: .secondary
        }
    }
}

/// Starting a thread from the phone. It uses the project's folder and the
/// supervised permissions the computer gives a paired device.
struct NewThreadView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.dismiss) private var dismiss
    @State private var project: Project?
    /// Photos shared from another app, sent with the first message.
    let images: [Data]
    let onCreated: (ChatThread) -> Void
    @State private var title = ""
    @State private var message: String
    @State private var working = false
    @State private var error: String?
    @State private var agents: [AgentInfo] = []
    @State private var agentID: String?
    @State private var mode: ThreadMode = .agent

    init(project: Project?, message: String = "", images: [Data] = [], onCreated: @escaping (ChatThread) -> Void) {
        _project = State(initialValue: project)
        _message = State(initialValue: message)
        self.images = images
        self.onCreated = onCreated
    }

    var body: some View {
        NavigationStack {
            Form {
                if project == nil || !images.isEmpty || workspace.projects.count > 1 {
                    Section {
                        Picker("Project", selection: $project) {
                            if project == nil { Text("Choose a project").tag(Project?.none) }
                            ForEach(workspace.projects) { item in Text(item.name).tag(Optional(item)) }
                        }
                        .pickerStyle(.navigationLink)
                    }
                }
                Section {
                    Picker("Mode", selection: $mode) {
                        ForEach(ThreadMode.allCases) { item in
                            Label(String(localized: item.title), systemImage: item.symbol).tag(item)
                        }
                    }
                    .pickerStyle(.menu)
                }
                if !agents.isEmpty {
                    Section {
                        Picker("Agent", selection: $agentID) {
                            Text("Project default").tag(String?.none)
                            ForEach(agents) { agent in
                                Label {
                                    Text(agent.name)
                                } icon: {
                                    if let harness = Harness(agent.id) ?? Harness(name: agent.name) { HarnessMark(harness, size: 20) }
                                }
                                .tag(Optional(agent.id))
                            }
                        }
                        .pickerStyle(.navigationLink)
                    }
                }
                Section {
                    TextField("Title (optional)", text: $title)
                    TextField("What should the agent do?", text: $message, axis: .vertical)
                        .lineLimit(3...10)
                    if !images.isEmpty {
                        ScrollView(.horizontal) {
                            HStack(spacing: 8) {
                                ForEach(images.indices, id: \.self) { index in
                                    if let image = UIImage(data: images[index]) {
                                        Image(uiImage: image).resizable().scaledToFill()
                                            .frame(width: 56, height: 56).clipShape(.rect(cornerRadius: 10))
                                            .accessibilityLabel(Text("Photo \(index + 1)"))
                                    }
                                }
                            }
                        }
                    }
                } footer: {
                    if let project {
                        Text("Runs in \(project.name)'s folder with supervised permissions. Change permissions on your computer if the agent needs more.")
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(Color.failure).font(.callout) }
                }
            }
            .navigationTitle("New thread")
            .navigationBarTitleDisplayMode(.inline)
            .tint(Color.textPrimary)
            .task { agents = (try? await workspace.agents()) ?? [] }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if working { ProgressView() } else {
                        Button("Start") { Task { await start() } }
                            .disabled(project == nil || message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && images.isEmpty)
                    }
                }
            }
        }
    }

    private func start() async {
        working = true
        defer { working = false }
        do {
            guard let project else { return }
            let thread = try await workspace.createThread(in: project.id, title: title, agentID: agentID)
            let model = workspace.model(for: thread.id)
            do {
                var attachments: [MessageAttachment] = []
                for (index, data) in images.enumerated() where workspace.canAttach {
                    attachments.append(try await workspace.upload(data, name: "Shared photo \(index + 1).jpg", mimeType: "image/jpeg", threadID: thread.id))
                }
                try await workspace.send(message.trimmingCharacters(in: .whitespacesAndNewlines), to: model, mode: mode, attachments: attachments)
            } catch {
                // The thread exists; open it with the message still to send.
                UserDefaults.standard.set(message, forKey: "draft.\(thread.id)")
            }
            Haptics.success()
            onCreated(thread)
            dismiss()
        } catch {
            self.error = error.localizedDescription
            Haptics.warning()
        }
    }
}

/*
 * For a computer reached by a name Bonjour can't see (a VPN or tailnet
 * address). The pinned certificate still has to match, so a wrong address
 * fails safely.
 */
struct AddressEditor: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.dismiss) private var dismiss
    let host: PairedHost
    @State private var address = ""
    @State private var port = ""

    private var portNumber: Int? { Int(port).flatMap { (1...65535).contains($0) ? $0 : nil } }
    private var trimmed: String { address.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Address", text: $address)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    TextField("Port", text: $port)
                        .keyboardType(.numberPad)
                } footer: {
                    Text(host.fingerprint != nil
                         ? "Capsule finds your computer on the same network by itself. Set an address for a VPN or private network. The computer's identity is still checked."
                         : "This pairing isn't encrypted, so the address isn't verified. Pair with a phone code for a checked connection.")
                }
            }
            .navigationTitle(host.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard let portNumber else { return }
                        Task { await workspace.updateAddress(of: host.id, host: trimmed, port: portNumber); dismiss() }
                    }
                    .disabled(trimmed.isEmpty || portNumber == nil)
                }
            }
            .onAppear { address = host.host; port = String(host.port) }
        }
    }
}

/// One paired computer: how it's reached, what this device may do, and when.
struct ComputerDetail: View {
    @Environment(Workspace.self) private var workspace
    let host: PairedHost
    let onForget: () -> Void
    let onEditAddress: () -> Void
    @State private var savedBytes = 0

    private var isActive: Bool { workspace.activeHostID == host.id }
    private var current: PairedHost { workspace.hosts.first { $0.id == host.id } ?? host }

    var body: some View {
        Form {
            Section {
                LabeledContent("Address") { Text(verbatim: "\(current.host):\(current.port)").font(.body.monospaced()) }
                LabeledContent("Connection") { Text(current.securitySummary) }
                LabeledContent("This device can") { Text(current.canControl ? "Send, stop and approve" : "Read only") }
                if isActive, let version = workspace.computerVersion {
                    LabeledContent("Capsule version", value: version)
                }
            }
            Section("Pairing") {
                LabeledContent("Paired", value: current.pairedAt.formatted(date: .abbreviated, time: .shortened))
                LabeledContent("Ends") {
                    Text(current.isExpired ? String(localized: "Expired") : current.expiresAt.formatted(date: .abbreviated, time: .shortened))
                        .foregroundStyle(current.isExpired ? Color.failure : Color.textSecondary)
                }
                if isActive, let last = workspace.lastConnected {
                    LabeledContent("Last connected", value: last.formatted(.relative(presentation: .named)))
                }
                if isActive, let problem = workspace.lastConnectionProblem, !workspace.isConnected {
                    LabeledContent("Last problem") { Text(problem).foregroundStyle(Color.attention) }
                }
            }
            Section {
                LabeledContent("Saved copy", value: ByteCountFormatter.string(fromByteCount: Int64(savedBytes), countStyle: .file))
                Button("Clear saved copy", role: .destructive) {
                    workspace.clearSavedCopy(of: current)
                    savedBytes = workspace.savedCopySize(of: current)
                }
                .disabled(savedBytes == 0)
            } footer: {
                Text("Recent threads kept on this device for when your computer can't be reached.")
            }
            Section {
                if !isActive {
                    Button("Use this computer", systemImage: "checkmark.circle") { Task { await workspace.activate(current.id) } }
                }
                Button("Edit address", systemImage: "network", action: onEditAddress)
                Button("Forget this computer", systemImage: "trash", role: .destructive, action: onForget)
            }
        }
        .navigationTitle(current.name)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { savedBytes = workspace.savedCopySize(of: current) }
    }
}

/// Usage limits a running agent has reported. Shown only when there is something to show.
private struct UsageSection: View {
    @Environment(Workspace.self) private var workspace
    @State private var snapshot: ProviderUsageSnapshot?

    var body: some View {
        Group {
            if let reports = snapshot?.reports, !reports.isEmpty {
                Section {
                    ForEach(reports) { source in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(source.report.tier.capitalized).font(.subheadline.weight(.medium))
                            UsageMeter(label: "This session", window: source.report.window)
                            UsageMeter(label: "This week", window: source.report.weekly)
                        }
                        .padding(.vertical, 4)
                    }
                } header: {
                    Text("Usage limits")
                } footer: {
                    Text("As last reported by a running agent; not a live balance.")
                }
            }
        }
        .task { snapshot = await workspace.providerUsage() }
    }
}

private struct UsageMeter: View {
    let label: LocalizedStringKey
    let window: ProviderUsageSnapshot.Window

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label).font(.footnote)
                Spacer()
                Text("\(Int(window.usedPercent.rounded()))%").font(.footnote.monospacedDigit()).foregroundStyle(Color.textSecondary)
            }
            ProgressView(value: min(1, max(0, window.usedPercent / 100)))
                .tint(window.usedPercent >= 90 ? Color.failure : window.usedPercent >= 70 ? Color.attention : Color.success)
            Text("Resets \(Date(timeIntervalSince1970: window.resetsAtMs / 1000).formatted(.relative(presentation: .named)))")
                .font(.caption)
                .foregroundStyle(Color.textTertiary)
        }
        .accessibilityElement(children: .combine)
    }
}
