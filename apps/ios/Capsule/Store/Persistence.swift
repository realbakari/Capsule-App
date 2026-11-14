import Foundation

/// What the app shows while it can't reach the computer.
nonisolated struct Snapshot: Codable, Sendable {
    var projects: [Project]
    var threads: [ChatThread]
    var latestRuns: [String: Run]
    var pendingApprovals: [Approval]
    var messages: [String: [ChatMessage]]
    var savedAt: Date
}

/*
 * Small, boring storage. Host records and preferences go in defaults; the
 * offline copy goes in Application Support with file protection, excluded
 * from backups because it is a cache of what lives on the computer.
 */
nonisolated enum Persistence {
    private static var defaults: UserDefaults { .standard }
    private static let hostsKey = "hosts.v1"
    private static let activeKey = "hosts.active"
    private static let viewedKey = "threads.lastViewed"

    static func loadHosts() -> [PairedHost] {
        guard let data = defaults.data(forKey: hostsKey) else { return [] }
        let hosts = (try? JSONDecoder().decode([PairedHost].self, from: data)) ?? []
        // Names saved before form-decoding was fixed read "Sam's+MacBook+Air".
        return hosts.map { host in
            var host = host
            if host.name.contains("+"), !host.name.contains(" ") { host.name = host.name.replacingOccurrences(of: "+", with: " ") }
            return host
        }
    }

    static func saveHosts(_ hosts: [PairedHost]) {
        defaults.set(try? JSONEncoder().encode(hosts), forKey: hostsKey)
    }

    static func activeHostID() -> UUID? {
        defaults.string(forKey: activeKey).flatMap(UUID.init(uuidString:))
    }

    static func setActiveHostID(_ id: UUID?) {
        defaults.set(id?.uuidString, forKey: activeKey)
    }

    static func lastViewed() -> [String: String] {
        defaults.dictionary(forKey: viewedKey) as? [String: String] ?? [:]
    }

    static func setLastViewed(_ value: [String: String]) {
        // Bounded: a long-lived install shouldn't grow this forever.
        let trimmed = value.count > 500 ? Dictionary(uniqueKeysWithValues: value.sorted { $0.value > $1.value }.prefix(500).map { ($0.key, $0.value) }) : value
        defaults.set(trimmed, forKey: viewedKey)
    }

    private static func snapshotURL(_ id: UUID) -> URL? {
        guard var dir = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true) else { return nil }
        dir.append(path: "snapshots", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? dir.setResourceValues(values)
        return dir.appending(path: "\(id.uuidString).json")
    }

    static func loadSnapshot(_ id: UUID) -> Snapshot? {
        guard let url = snapshotURL(id), let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(Snapshot.self, from: data)
    }

    static func saveSnapshot(_ snapshot: Snapshot, for id: UUID) {
        guard let url = snapshotURL(id) else { return }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(snapshot) else { return }
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    /// Bytes used by a computer's saved copy.
    static func snapshotSize(_ id: UUID) -> Int {
        guard let url = snapshotURL(id), let values = try? url.resourceValues(forKeys: [.fileSizeKey]) else { return 0 }
        return values.fileSize ?? 0
    }

    static func deleteSnapshot(_ id: UUID) {
        guard let url = snapshotURL(id) else { return }
        try? FileManager.default.removeItem(at: url)
    }
}
