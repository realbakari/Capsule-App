import SwiftUI

/*
 * Choosing a skill for the next message. The attached one sits on top with a
 * way to remove it, then the ones used lately, then every skill by name; a
 * search ranks names before descriptions.
 */
struct SkillPicker: View {
    let skills: [SkillInfo]
    @Binding var selection: SkillInfo?
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var recent = RecentSkills.load()

    private var searching: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }
    private var recentSkills: [SkillInfo] { recent.compactMap { id in skills.first { $0.id == id } }.prefix(4).map { $0 } }
    private var results: [SkillInfo] { SkillSearch.rank(skills, query: query) }

    var body: some View {
        NavigationStack {
            CapsuleList {
                if let selection, !searching {
                    Section("Attached") {
                        SkillRow(skill: selection, selected: true) { dismiss() }
                        Button("Remove skill", systemImage: "xmark.circle", role: .destructive) {
                            self.selection = nil
                            Haptics.selection()
                            dismiss()
                        }
                    }
                }
                if !searching && !recentSkills.isEmpty {
                    Section("Recent") {
                        ForEach(recentSkills) { skill in SkillRow(skill: skill, selected: skill.id == selection?.id) { pick(skill) } }
                    }
                }
                Section {
                    ForEach(results) { skill in SkillRow(skill: skill, selected: skill.id == selection?.id) { pick(skill) } }
                } header: {
                    if !searching { Text("All skills") }
                }
            }
            .listSectionSpacing(.compact)
            .overlay { if searching && results.isEmpty { ContentUnavailableView.search(text: query) } }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: Text("Search skills"))
            .navigationTitle("Skills")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func pick(_ skill: SkillInfo) {
        selection = skill
        RecentSkills.record(skill.id)
        Haptics.selection()
        dismiss()
    }
}

private struct SkillRow: View {
    let skill: SkillInfo
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(skill.name).font(.body).foregroundStyle(Color.textPrimary)
                    if let detail = skill.description, !detail.isEmpty {
                        Text(detail).font(.subheadline).foregroundStyle(Color.textMuted).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                if selected {
                    Image(systemName: "checkmark").font(.body.weight(.semibold)).foregroundStyle(Color.textPrimary)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
