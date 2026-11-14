import Foundation

/// The App Group the app and its extensions read and write.
nonisolated enum SharedStore {
    static let group = "group.dev.capsule.mobile.shared"
    static var defaults: UserDefaults? { UserDefaults(suiteName: group) }
}
