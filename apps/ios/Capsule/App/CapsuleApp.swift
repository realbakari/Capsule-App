import BackgroundTasks
import SwiftUI

@main
struct CapsuleApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var workspace = Workspace()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(workspace)
                .modifier(ThemeOverride())
                .onOpenURL { url in Router.shared.open(url) }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                workspace.connect()
                // Something shared from another app while Capsule was closed.
                if Router.shared.pendingShare == nil { Router.shared.pendingShare = SharedInbox.next() }
                Task { await workspace.retryNow() }
            case .background:
                workspace.noteAway()
                BackgroundRefresh.schedule()
                QuickActions.update(threads: workspace.threads)
                Task { await workspace.enterBackground() }
            default:
                break
            }
        }
        // iPad: a thread in a window of its own, from a row's Open in New Window.
        WindowGroup("Thread", id: "thread", for: String.self) { $threadID in
            if let threadID {
                NavigationStack { ThreadView(threadID: threadID) }
                    .environment(workspace)
                    .modifier(ThemeOverride())
                    .tint(Color.textPrimary)
            }
        }
        .backgroundTask(.appRefresh(BackgroundRefresh.identifier)) {
            BackgroundRefresh.schedule()
            await workspace.backgroundCheck()
        }
    }
}

/// Pairing links opened from the camera, a message, or a QR code.
@Observable
final class Router {
    static let shared = Router()
    var pendingLink: String?
    var pendingThreadLink: URL?
    var pendingShare: SharedItem?

    func open(_ url: URL) {
        if url.scheme == "capsule", url.host == "thread" {
            pendingThreadLink = url
        } else {
            pendingLink = url.absoluteString
        }
    }
}

nonisolated enum BackgroundRefresh {
    static let identifier = "dev.capsule.mobile.refresh"

    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
}

/*
 * Home Screen quick actions: touch and hold the icon for the three most
 * recently active threads. Each opens through the same thread link a copied
 * link uses.
 */
enum QuickActions {
    static func update(threads: [ChatThread]) {
        let recent = threads.filter { !$0.isArchived }.sorted { $0.updatedAt > $1.updatedAt }.prefix(3)
        UIApplication.shared.shortcutItems = recent.map { thread in
            UIApplicationShortcutItem(type: "dev.capsule.mobile.thread", localizedTitle: thread.title.isEmpty ? String(localized: "Untitled thread") : thread.title,
                                      localizedSubtitle: nil, icon: UIApplicationShortcutIcon(systemImageName: "bubble.left"),
                                      userInfo: ["id": thread.id as NSString])
        }
    }

    static func handle(_ item: UIApplicationShortcutItem) {
        guard let id = item.userInfo?["id"] as? String,
              let url = URL(string: "capsule://thread?id=\(id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? id)") else { return }
        Router.shared.open(url)
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        if let item = options.shortcutItem { QuickActions.handle(item) }
        let configuration = UISceneConfiguration(name: nil, sessionRole: session.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem) async -> Bool {
        QuickActions.handle(shortcutItem)
        return true
    }
}
