import SwiftUI

struct RootView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.horizontalSizeClass) private var horizontalSize
    @State private var selection: String?
    @State private var path: [String] = []
    @State private var columns = NavigationSplitViewVisibility.all
    @State private var pairingLink: PairingSheetRequest?
    @State private var handledShare: String?
    private let router = Router.shared

    var body: some View {
        Group {
            if workspace.hosts.isEmpty && !workspace.isSample {
                WelcomeView()
            } else if horizontalSize == .compact {
                // iPhone: a plain stack, so every way into a thread pushes the same way.
                NavigationStack(path: $path) {
                    ThreadListView(selection: openBinding)
                        .navigationDestination(for: String.self) { id in
                            ThreadView(threadID: id)
                        }
                }
            } else {
                NavigationSplitView(columnVisibility: $columns) {
                    ThreadListView(selection: $selection)
                } detail: {
                    if let selection {
                        ThreadView(threadID: selection)
                            .id(selection)
                    } else {
                        ContentUnavailableView("Choose a thread", systemImage: "bubble.left.and.text.bubble.right",
                                               description: Text("Conversations from your computer appear in the list."))
                            .background(Color.screen)
                    }
                }
                .navigationSplitViewStyle(.balanced)
                // An open inspector takes the sidebar's room; closing it gives it back.
                .environment(\.sidebarRoom, SidebarRoom { needed in
                    withAnimation(.snappy) { columns = needed ? .detailOnly : .all }
                })
            }
        }
        .tint(Color.textPrimary)
        .onAppear {
            #if DEBUG
            // Screen checks without touch input: `-CapsuleSample YES -CapsuleOpen <thread id>`.
            if UserDefaults.standard.bool(forKey: "CapsuleSample") { workspace.startSample() }
            // `-CapsuleBackdrop mesh` (or grain, night, dots, paper): draw that scene as if the computer set it.
            if let name = UserDefaults.standard.string(forKey: "CapsuleBackdrop"), let scene = Backdrop.Scene(rawValue: name) {
                let backdrop = Backdrop(scene: scene, opacity: 1, blur: 0, dim: 0)
                workspace.debugSetBackdrop(BackdropPair(light: backdrop, dark: backdrop))
            }
            // `-CapsuleActivity YES` with the sample: the approval's Live Activity, for checking the Lock Screen.
            if UserDefaults.standard.bool(forKey: "CapsuleActivity") { workspace.supervise(.approval(SampleData.approval)) }
            // `-CapsuleShare YES`: a share as if it came from another app's share sheet.
            if UserDefaults.standard.bool(forKey: "CapsuleShare"),
               let item = try? SharedInbox.save(text: "Why does the hourly chart skip midnight?", url: "https://example.com/issue/42", images: []) {
                router.pendingShare = item
            }
            if let id = UserDefaults.standard.string(forKey: "CapsuleOpen") {
                Task { try? await Task.sleep(for: .milliseconds(600)); open(id) }
            }
            #endif
            workspace.notifier.onOpenThread = { [workspace] id, hostID in
                // A notification from another computer makes it the active one first.
                guard let hostID, hostID != workspace.activeHostID else { open(id); return }
                Task { await workspace.activate(hostID); open(id) }
            }
            workspace.installApprovalHandling()
            workspace.notifier.onApprovalAction = { [workspace] id, decision, hostID in
                await workspace.resolveFromNotification(approvalID: id, decision, hostID: hostID)
            }
        }
        .onChange(of: router.pendingThreadLink, initial: true) { _, link in
            guard let link else { return }
            router.pendingThreadLink = nil
            Task { if let id = await workspace.open(threadLink: link) { open(id) } }
        }
        .onChange(of: router.pendingLink, initial: true) { _, link in
            guard let link else { return }
            router.pendingLink = nil
            pairingLink = PairingSheetRequest(link: link)
        }
        .onChange(of: horizontalSize) { _, size in
            // Rotating an iPad or resizing a window keeps the open thread open.
            if size == .compact, let selection, path.isEmpty { path = [selection] }
            if size == .regular, let last = path.last { selection = last; path = [] }
        }
        .sheet(item: $pairingLink) { request in
            PairingView(initialLink: request.link)
        }
        .sheet(item: Bindable(router).pendingShare, onDismiss: {
            // Started or cancelled, the share is done with.
            if let id = handledShare { SharedInbox.remove(id); handledShare = nil }
        }) { item in
            NewThreadView(project: workspace.projects.count == 1 ? workspace.projects.first : nil,
                          message: item.message, images: SharedInbox.imageData(item)) { thread in open(thread.id) }
                .onAppear { handledShare = item.id }
        }
    }

    /// The list writes a thread id here; on iPhone that pushes it.
    private var openBinding: Binding<String?> {
        Binding(get: { path.last }, set: { id in if let id { open(id) } })
    }

    private func open(_ id: String) {
        if horizontalSize == .compact {
            if path.last != id { path = [id] }
        } else {
            selection = id
        }
    }
}

struct PairingSheetRequest: Identifiable {
    let id = UUID()
    let link: String
}

/// First launch, on the mark's own graphite: what the app is and how to pair.
struct WelcomeView: View {
    @Environment(Workspace.self) private var workspace
    @State private var showPairing = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            Image("LaunchMark")
                .resizable()
                .scaledToFit()
                .frame(width: 96, height: 96)
                .accessibilityHidden(true)
            Text("Capsule")
                .font(.largeTitle.weight(.semibold))
                .foregroundStyle(Color.brandText)
                .padding(.top, 20)
            Text("Your coding agents, in your pocket. Follow threads as they stream, review every change, and answer approvals while the work runs on your computer.")
                .font(.body)
                .foregroundStyle(Color.brandText.opacity(0.62))
                .multilineTextAlignment(.center)
                .padding(.top, 10)
                .padding(.horizontal, 36)
            Spacer()
            VStack(alignment: .leading, spacing: 14) {
                FeatureLine(symbol: "lock.shield", text: "Encrypted to your computer, verified by its code")
                FeatureLine(symbol: "bell.badge", text: "Know when an agent needs you, while Capsule is open")
                FeatureLine(symbol: "plusminus", text: "Every turn's changes, file by file")
            }
            .padding(.horizontal, 36)
            .padding(.bottom, 32)
            Button {
                showPairing = true
            } label: {
                Label("Pair with your computer", systemImage: "qrcode.viewfinder")
            }
            .buttonStyle(BrandButtonStyle())
            .padding(.horizontal, 24)
            Button("Try a sample workspace") { workspace.startSample() }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color.brandText.opacity(0.75))
                .padding(.top, 12)
                .accessibilityHint(Text("Explore Capsule with made-up threads. Nothing is sent anywhere."))
            Text("On your computer: Settings → Gateway → Browser access → Pair a phone.")
                .font(.footnote)
                .foregroundStyle(Color.brandText.opacity(0.5))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 14)
                .padding(.bottom, 20)
        }
        .frame(maxWidth: 480)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.brand.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showPairing) { PairingView().preferredColorScheme(nil) }
    }
}

private struct FeatureLine: View {
    let symbol: String
    let text: LocalizedStringKey

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.body.weight(.medium))
                .foregroundStyle(Color.brandText.opacity(0.85))
                .frame(width: 32, height: 32)
                .background(Color.white.opacity(0.07), in: .rect(cornerRadius: 9, style: .continuous))
            Text(text)
                .font(.subheadline)
                .foregroundStyle(Color.brandText.opacity(0.78))
        }
        .accessibilityElement(children: .combine)
    }
}

/// Lets a thread hide the sidebar while its inspector column is open.
struct SidebarRoom {
    let set: (Bool) -> Void
    func callAsFunction(_ needed: Bool) { set(needed) }
}

extension EnvironmentValues {
    @Entry var sidebarRoom: SidebarRoom? = nil
}
