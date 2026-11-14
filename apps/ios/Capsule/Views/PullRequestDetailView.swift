import SwiftUI

/// What the phone reads of a pull request. Merging and reviewing stay on the computer.
nonisolated struct PullRequestDetail: Decodable, Sendable {
    nonisolated struct Label: Decodable, Sendable, Hashable { var name: String; var color: String? }
    nonisolated struct Check: Decodable, Sendable, Hashable { var name: String; var workflow: String?; var state: String; var url: String? }
    nonisolated struct File: Decodable, Sendable, Hashable { var path: String; var additions: Int; var deletions: Int }
    nonisolated struct Activity: Decodable, Sendable, Hashable, Identifiable {
        var id: String; var kind: String; var author: String?; var body: String; var createdAt: String?; var state: String?
    }

    var number: Int
    var url: String
    var title: String
    var isDraft: Bool
    var state: String
    var reviewDecision: String?
    var author: String?
    var headRefName: String?
    var baseRefName: String?
    var body: String
    var additions: Int
    var deletions: Int
    var changedFiles: Int
    var labels: [Label]?
    var reviewers: [String]?
    var checkRuns: [Check]?
    var files: [File]?
    var activity: [Activity]?
    var diff: String?
}

struct PullRequestDetailView: View {
    @Environment(Workspace.self) private var workspace
    let projectID: String
    let threadID: String?
    let number: Int

    var body: some View {
        Loadable(load: { try await workspace.pullRequest(projectID: projectID, number: number, threadID: threadID) }) { pr in
            List {
                header(pr)
                if !pr.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Section("Description") {
                        MarkdownView(text: pr.body).modifier(ReadingFont())
                    }
                }
                checks(pr)
                files(pr)
                activity(pr)
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Color.screen)
        }
        .navigationTitle(Text(verbatim: "#\(number)"))
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder private func header(_ pr: PullRequestDetail) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Text(pr.title).font(.title3.weight(.semibold)).foregroundStyle(Color.textPrimary)
                HStack(spacing: 6) {
                    stateBadge(pr)
                    if let author = pr.author { Text(author).foregroundStyle(Color.textSecondary) }
                }
                .font(.footnote)
                if let head = pr.headRefName {
                    Text(verbatim: "\(pr.baseRefName ?? "main") ← \(head)")
                        .font(.caption.monospaced()).foregroundStyle(Color.textMuted).lineLimit(1).truncationMode(.middle)
                }
                HStack(spacing: 10) {
                    Text(verbatim: "+\(pr.additions)").foregroundStyle(Color.success)
                    Text(verbatim: "−\(pr.deletions)").foregroundStyle(Color.failure)
                    Text("\(pr.changedFiles) changed files").foregroundStyle(Color.textMuted)
                }
                .font(.caption.monospacedDigit())
                if let labels = pr.labels, !labels.isEmpty {
                    ScrollView(.horizontal) {
                        HStack(spacing: 6) {
                            ForEach(labels, id: \.self) { label in
                                Text(label.name).font(.caption2.weight(.medium))
                                    .padding(.horizontal, 8).padding(.vertical, 3)
                                    .background(Self.color(label.color).opacity(0.18), in: .capsule)
                                    .overlay(Capsule().strokeBorder(Self.color(label.color).opacity(0.5), lineWidth: 0.5))
                            }
                        }
                    }
                    .scrollIndicators(.hidden)
                }
            }
            .padding(.vertical, 4)
            if let url = URL(string: pr.url) {
                Link(destination: url) { Label("Open on the web", systemImage: "safari") }
            }
        }
        .listRowBackground(Color.card)
    }

    private func stateBadge(_ pr: PullRequestDetail) -> some View {
        let (text, tint): (LocalizedStringResource, Color) = switch (pr.state.uppercased(), pr.isDraft) {
        case ("MERGED", _): ("Merged", .textPrimary)
        case ("CLOSED", _): ("Closed", .failure)
        case (_, true): ("Draft", .textMuted)
        default: ("Open", .success)
        }
        return Text(text).font(.caption.weight(.semibold)).foregroundStyle(tint)
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(tint.opacity(0.12), in: .capsule)
    }

    @ViewBuilder private func checks(_ pr: PullRequestDetail) -> some View {
        if let runs = pr.checkRuns, !runs.isEmpty {
            Section("Checks") {
                // Failures first: that's what you opened this for.
                ForEach(runs.sorted { Self.rank($0.state) < Self.rank($1.state) }, id: \.self) { check in
                    HStack(spacing: 10) {
                        Image(systemName: Self.symbol(check.state)).foregroundStyle(Self.tint(check.state))
                            .accessibilityLabel(Text(check.state))
                        VStack(alignment: .leading, spacing: 1) {
                            Text(check.name).font(.subheadline).foregroundStyle(Color.textPrimary).lineLimit(1)
                            if let workflow = check.workflow { Text(workflow).font(.caption).foregroundStyle(Color.textMuted).lineLimit(1) }
                        }
                    }
                }
            }
            .listRowBackground(Color.card)
        }
    }

    @ViewBuilder private func files(_ pr: PullRequestDetail) -> some View {
        if let files = pr.files, !files.isEmpty {
            let patches = UnifiedDiff.parse(pr.diff ?? "").files
            Section("Files") {
                ForEach(files, id: \.self) { file in
                    let patch = patches.first { $0.path == file.path }
                    NavigationLink {
                        if let patch {
                            PatchLines(file: patch)
                                .background(Color.screen)
                                .navigationTitle((file.path as NSString).lastPathComponent)
                                .navigationBarTitleDisplayMode(.inline)
                        } else {
                            ContentUnavailableView("No patch here", systemImage: "doc", description: Text("This file's change is too large to show on the phone."))
                        }
                    } label: {
                        HStack {
                            Text(file.path).font(.footnote.monospaced()).foregroundStyle(Color.textPrimary).lineLimit(1).truncationMode(.head)
                            Spacer(minLength: 8)
                            Text(verbatim: "+\(file.additions)").foregroundStyle(Color.success)
                            Text(verbatim: "−\(file.deletions)").foregroundStyle(Color.failure)
                        }
                        .font(.caption.monospacedDigit())
                    }
                }
            }
            .listRowBackground(Color.card)
        }
    }

    @ViewBuilder private func activity(_ pr: PullRequestDetail) -> some View {
        if let items = pr.activity?.filter({ !$0.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }), !items.isEmpty {
            Section("Conversation") {
                ForEach(items) { item in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(item.author ?? String(localized: "Someone")).font(.footnote.weight(.semibold))
                            if item.kind == "review", let state = item.state {
                                Text(state.replacingOccurrences(of: "_", with: " ").capitalized).font(.caption).foregroundStyle(Color.textMuted)
                            }
                            Spacer()
                            if let date = item.createdAt.flatMap(Timestamp.date) {
                                Text(date, format: .relative(presentation: .named)).font(.caption).foregroundStyle(Color.textTertiary)
                            }
                        }
                        MarkdownView(text: item.body).font(.subheadline)
                    }
                    .padding(.vertical, 4)
                }
            }
            .listRowBackground(Color.card)
        }
    }

    static func rank(_ state: String) -> Int {
        switch state { case "failure", "cancelled": 0; case "pending": 1; default: 2 }
    }

    static func symbol(_ state: String) -> String {
        switch state {
        case "success": "checkmark.circle.fill"
        case "failure", "cancelled": "xmark.circle.fill"
        case "pending": "clock"
        default: "minus.circle"
        }
    }

    static func tint(_ state: String) -> Color {
        switch state {
        case "success": .success
        case "failure", "cancelled": .failure
        case "pending": .attention
        default: .textMuted
        }
    }

    /// A label's six-digit hex colour.
    static func color(_ hex: String?) -> Color {
        guard let hex, hex.count == 6, let value = UInt32(hex, radix: 16) else { return .textMuted }
        return Color(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }
}
