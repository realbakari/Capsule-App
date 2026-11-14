import SwiftUI

/// "While you were away", at the top of the thread list.
struct BriefCard: View {
    let brief: Brief
    let open: (String) -> Void
    let dismiss: () -> Void
    @State private var expanded = false

    private var shown: [Brief.Item] { expanded ? brief.items : Array(brief.items.prefix(3)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("While you were away").font(.headline).foregroundStyle(Color.textPrimary)
                    Text(summary).font(.footnote).foregroundStyle(Color.textMuted)
                }
                Spacer(minLength: 8)
                Button(action: dismiss) {
                    Image(systemName: "xmark").font(.caption.weight(.bold)).foregroundStyle(Color.textMuted)
                        .frame(width: 28, height: 28).background(Color.subtle, in: .circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Dismiss summary"))
            }
            .padding(.bottom, 10)
            ForEach(shown) { item in
                Button { open(item.threadID) } label: { row(item) }
                    .buttonStyle(RowButtonStyle())
                if item.id != shown.last?.id { Divider().overlay(Color.hairline).padding(.leading, 26) }
            }
            if brief.items.count > 3 {
                Button(expanded ? String(localized: "Show less") : String(localized: "Show \(brief.items.count - 3) more")) {
                    withAnimation(.snappy) { expanded.toggle() }
                }
                .font(.footnote.weight(.medium))
                .foregroundStyle(Color.textSecondary)
                .padding(.top, 8)
                .padding(.leading, 26)
            }
        }
        .padding(16)
        .background(Color.card, in: .rect(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.hairline))
    }

    private func row(_ item: Brief.Item) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            symbol(item.outcome).font(.footnote).frame(width: 16)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(item.title).font(.subheadline.weight(.medium)).foregroundStyle(Color.textPrimary).lineLimit(1)
                    Spacer(minLength: 6)
                    Text(item.at, format: .relative(presentation: .named)).font(.caption).foregroundStyle(Color.textTertiary)
                }
                if let line = item.line {
                    Text(line).font(.footnote).foregroundStyle(Color.textSecondary).lineLimit(2)
                }
            }
        }
        .padding(.vertical, 9)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityHint(Text("Opens the thread."))
    }

    @ViewBuilder private func symbol(_ outcome: Brief.Item.Outcome) -> some View {
        switch outcome {
        case .needsYou: Image(systemName: "hand.raised.fill").foregroundStyle(Color.attention).accessibilityLabel(Text("Needs you"))
        case .finished: Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.success).accessibilityLabel(Text("Finished"))
        case .failed: Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Color.failure).accessibilityLabel(Text("Failed"))
        case .stopped: Image(systemName: "stop.circle.fill").foregroundStyle(Color.textMuted).accessibilityLabel(Text("Stopped"))
        }
    }

    /// "1 needs you · 2 finished · since 9:12"
    private var summary: String {
        var parts: [String] = []
        if brief.needsYou > 0 { parts.append(String(localized: "\(brief.needsYou) need you")) }
        if brief.finished > 0 { parts.append(String(localized: "\(brief.finished) finished")) }
        if brief.failed > 0 { parts.append(String(localized: "\(brief.failed) failed")) }
        parts.append(String(localized: "since \(brief.since.formatted(date: Calendar.current.isDateInToday(brief.since) ? .omitted : .abbreviated, time: .shortened))"))
        return parts.joined(separator: " · ")
    }
}
