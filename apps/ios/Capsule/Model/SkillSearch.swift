import Foundation

/// Finding a skill by what the user types, in the picker and after "/".
nonisolated enum SkillSearch {
    /*
     * With no query: recently used first, newest first, then by name. With a
     * query: names that start with it, then names with a word that does, then
     * names or ids containing it, then descriptions; by name within each.
     */
    static func rank(_ skills: [SkillInfo], query: String, recent: [String] = []) -> [SkillInfo] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        func byName(_ a: SkillInfo, _ b: SkillInfo) -> Bool { a.name.localizedStandardCompare(b.name) == .orderedAscending }
        guard !q.isEmpty else {
            let recentFirst = recent.compactMap { id in skills.first { $0.id == id } }
            return recentFirst + skills.filter { !recent.contains($0.id) }.sorted(by: byName)
        }
        return skills.compactMap { skill in tier(skill, q).map { (skill, $0) } }
            .sorted { $0.1 != $1.1 ? $0.1 < $1.1 : byName($0.0, $1.0) }
            .map(\.0)
    }

    private static func tier(_ skill: SkillInfo, _ q: String) -> Int? {
        let name = skill.name.lowercased()
        if name.hasPrefix(q) { return 0 }
        if name.split(whereSeparator: { !$0.isLetter && !$0.isNumber }).contains(where: { $0.hasPrefix(q) }) { return 1 }
        if name.contains(q) || skill.id.lowercased().contains(q) { return 2 }
        if skill.description?.lowercased().contains(q) == true { return 3 }
        return nil
    }
}

/// Skills the user attached lately, newest first, kept across launches.
nonisolated enum RecentSkills {
    static let storageKey = "skills.recent"
    static let limit = 6

    static func adding(_ id: String, to list: [String]) -> [String] {
        Array(([id] + list.filter { $0 != id }).prefix(limit))
    }

    static func load(_ defaults: UserDefaults = .standard) -> [String] {
        defaults.stringArray(forKey: storageKey) ?? []
    }

    static func record(_ id: String, _ defaults: UserDefaults = .standard) {
        defaults.set(adding(id, to: load(defaults)), forKey: storageKey)
    }
}
