import Foundation

/*
 * Things shared into Capsule from other apps, waiting for the app to open.
 *
 * The share extension writes each share to the App Group container: a
 * small JSON note plus any photos, already reduced to JPEG. The app picks
 * the oldest up when it becomes active and offers it as a new thread. A
 * share left for a week is dropped.
 */
nonisolated struct SharedItem: Codable, Identifiable, Sendable, Equatable {
    var id: String
    var text: String
    var url: String?
    /// File names of photos in this share's folder.
    var images: [String]
    var createdAt: Date

    /// What goes in the new thread's message box.
    var message: String {
        [text.trimmingCharacters(in: .whitespacesAndNewlines), url ?? ""]
            .filter { !$0.isEmpty }
            .joined(separator: "\n\n")
    }
}

nonisolated enum SharedInbox {
    static let maxImages = 4
    private static let expiry: TimeInterval = 7 * 24 * 3600

    static var root: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SharedStore.group)?
            .appending(path: "Inbox", directoryHint: .isDirectory)
    }

    static func folder(_ id: String) -> URL? { root?.appending(path: id, directoryHint: .isDirectory) }

    /// Writes a share; called from the extension.
    static func save(text: String, url: String?, images: [Data]) throws -> SharedItem {
        guard let root else { throw CocoaError(.fileNoSuchFile) }
        let id = UUID().uuidString
        let folder = root.appending(path: id, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true,
                                                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var names: [String] = []
        for (index, data) in images.prefix(maxImages).enumerated() {
            let name = "photo-\(index + 1).jpg"
            try data.write(to: folder.appending(path: name), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            names.append(name)
        }
        let item = SharedItem(id: id, text: String(text.prefix(20_000)), url: url, images: names, createdAt: .now)
        try JSONEncoder().encode(item).write(to: folder.appending(path: "item.json"), options: .atomic)
        return item
    }

    /// The oldest waiting share, dropping any that have expired.
    static func next() -> SharedItem? {
        guard let root, let folders = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { return nil }
        let items = folders.compactMap { folder -> SharedItem? in
            guard let data = try? Data(contentsOf: folder.appending(path: "item.json")),
                  let item = try? JSONDecoder().decode(SharedItem.self, from: data) else {
                try? FileManager.default.removeItem(at: folder)
                return nil
            }
            if item.createdAt.timeIntervalSinceNow < -expiry { remove(item.id); return nil }
            return item
        }
        return items.min { $0.createdAt < $1.createdAt }
    }

    static func imageData(_ item: SharedItem) -> [Data] {
        guard let folder = folder(item.id) else { return [] }
        return item.images.compactMap { try? Data(contentsOf: folder.appending(path: $0)) }
    }

    static func remove(_ id: String) {
        guard let folder = folder(id) else { return }
        try? FileManager.default.removeItem(at: folder)
    }
}
