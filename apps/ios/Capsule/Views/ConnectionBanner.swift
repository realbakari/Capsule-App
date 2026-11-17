import SwiftUI

/*
 * Says, without being asked, whether what's on screen is live. Hidden when
 * connected; otherwise one line with what's happening and one action. A
 * connection that comes back within a second never shows "Connecting…": the
 * banner would only flash.
 */
struct ConnectionBanner: View {
    @Environment(Workspace.self) private var workspace
    @State private var showPairing = false
    /// Set once a connection attempt has lasted long enough to mention.
    @State private var connectingShown = false

    private var isConnecting: Bool { if case .connecting = workspace.connectionState { true } else { false } }

    var body: some View {
        VStack(spacing: 0) {
            if let content {
                HStack(spacing: 10) {
                    Image(systemName: content.symbol)
                        .foregroundStyle(content.tint)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(content.title).font(.subheadline.weight(.semibold))
                        if let detail = content.detail {
                            Text(detail).font(.caption).foregroundStyle(Color.textMuted)
                        }
                    }
                    Spacer(minLength: 8)
                    if let action = content.action {
                        Button(action.title) {
                            switch action.kind {
                            case .retry: Task { await workspace.retryNow() }
                            case .pair: showPairing = true
                            case .exitSample: workspace.endSample()
                            }
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.regularMaterial, in: .rect(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.hairline, lineWidth: 0.5))
                .padding(.horizontal, 12)
                .padding(.top, 4)
                .padding(.bottom, 6)
                .accessibilityElement(children: .combine)
                .sheet(isPresented: $showPairing) { PairingView() }
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .task(id: isConnecting) {
            connectingShown = false
            guard isConnecting else { return }
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            withAnimation(.snappy) { connectingShown = true }
        }
    }

    private struct Content {
        enum Kind { case retry, pair, exitSample }
        var symbol: String
        var tint: Color
        var title: LocalizedStringResource
        var detail: String?
        var action: (title: LocalizedStringResource, kind: Kind)?
    }

    private var savedCopy: String? {
        workspace.lastSynced.map { String(localized: "Showing what was saved \($0.formatted(.relative(presentation: .named))).") }
    }

    private var content: Content? {
        if workspace.isSample {
            return Content(symbol: "sparkles.rectangle.stack", tint: .textSecondary, title: "Just looking around",
                           detail: String(localized: "These threads are made up, and nothing you do here is sent anywhere."),
                           action: ("Exit", .exitSample))
        }
        switch workspace.connectionState {
        case .ready:
            return nil
        case .idle:
            return workspace.activeHost == nil ? nil
                : Content(symbol: "bolt.horizontal.circle", tint: .secondary, title: "Not connected", detail: savedCopy, action: ("Connect", .retry))
        case .connecting(let attempt):
            guard connectingShown else { return nil }
            return Content(symbol: "arrow.triangle.2.circlepath", tint: .secondary,
                           title: attempt > 1 ? "Reconnecting…" : "Connecting…", detail: savedCopy, action: nil)
        case .waiting(_, let reason):
            return Content(symbol: "wifi.exclamationmark", tint: .attention, title: "Offline",
                           detail: [reason, String(localized: "Retrying automatically."), savedCopy].compactMap { $0 }.joined(separator: " "),
                           action: ("Retry now", .retry))
        case .unauthorized:
            return Content(symbol: "lock.slash", tint: .failure, title: "Pairing ended",
                           detail: String(localized: "It expired or was removed on your computer. Pair again to see live updates."),
                           action: ("Pair again", .pair))
        }
    }
}

/// The connection banner in a screen's top inset, over the screen colour that runs up
/// under the navigation bar. What scrolls up then disappears under a plain ground, so
/// the bar's glass buttons never sit on a stray line of text or a code chip.
struct CoveredBanner: View {
    var cover = true

    var body: some View {
        VStack(spacing: 0) { ConnectionBanner() }
            .frame(maxWidth: .infinity)
            .background {
                if cover { Color.screen.ignoresSafeArea(edges: .top) }
            }
    }
}
