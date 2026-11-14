import SwiftUI
import VisionKit

/*
 * Pairing: scan the code on the computer's screen, or paste its link. The
 * code is single use and lasts five minutes, so a failure says which of
 * those it was and what to do, rather than "something went wrong".
 */
struct PairingView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.dismiss) private var dismiss
    var initialLink: String?

    @State private var linkText = ""
    @State private var pairing = false
    @State private var error: String?
    @State private var scanning = false
    @State private var scannedOnce = false

    private var canScan: Bool { DataScannerViewController.isSupported }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        step(1, "On your computer, open Capsule → Settings → Gateway → Browser access.")
                        step(2, "Set the reach to This network, then choose Pair a phone.")
                        step(3, canScan ? "Scan the code it shows, or paste its link below." : "Copy its link and paste it below.")
                    }
                    .padding(.vertical, 4)
                }

                if canScan {
                    Section {
                        if scanning {
                            QRScanner { value in
                                guard !scannedOnce else { return }
                                scannedOnce = true
                                linkText = value
                                scanning = false
                                Task { await pair() }
                            }
                            .frame(height: 280)
                            .clipShape(.rect(cornerRadius: 12))
                            .listRowInsets(EdgeInsets())
                            .accessibilityLabel(Text("Camera viewfinder for the pairing code"))
                        } else {
                            Button {
                                scannedOnce = false
                                scanning = true
                            } label: {
                                Label("Scan pairing code", systemImage: "qrcode.viewfinder")
                            }
                        }
                    }
                }

                Section {
                    TextField("capsule://pair?…", text: $linkText, axis: .vertical)
                        .lineLimit(1...4)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .font(.callout.monospaced())
                        .accessibilityLabel(Text("Pairing link"))
                    Button {
                        if let pasted = UIPasteboard.general.string { linkText = pasted }
                    } label: {
                        Label("Paste", systemImage: "doc.on.clipboard")
                    }
                } header: {
                    Text("Pairing link")
                } footer: {
                    Text("A phone code from your computer is encrypted and lets you send messages and answer approvals. A browser link over plain HTTP only lets you read.")
                }

                if let error {
                    Section {
                        Label {
                            Text(error)
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Color.failure)
                        }
                        .font(.callout)
                    }
                }
            }
            .navigationTitle("Pair a computer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if pairing {
                        ProgressView()
                    } else {
                        Button("Pair") { Task { await pair() } }
                            .disabled(linkText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
            .onAppear {
                if let initialLink, linkText.isEmpty {
                    linkText = initialLink
                    Task { await pair() }
                }
            }
        }
    }

    private func step(_ number: Int, _ text: LocalizedStringKey) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(number)")
                .font(.footnote.weight(.bold).monospacedDigit())
                .frame(width: 22, height: 22)
                .background(Color.subtleStrong, in: .circle)
                .accessibilityHidden(true)
            Text(text).font(.subheadline)
        }
    }

    private func pair() async {
        guard !pairing else { return }
        error = nil
        let link: PairingLink
        do {
            link = try PairingLink.parse(linkText)
        } catch {
            self.error = error.localizedDescription
            Haptics.warning()
            return
        }
        pairing = true
        defer { pairing = false }
        do {
            try await workspace.pair(with: link)
            Haptics.success()
            dismiss()
        } catch {
            self.error = error.localizedDescription
            Haptics.warning()
        }
    }
}

/// The system's live-text scanner, limited to QR codes.
struct QRScanner: UIViewControllerRepresentable {
    let onFound: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    func updateUIViewController(_ controller: DataScannerViewController, context: Context) {}

    static func dismantleUIViewController(_ controller: DataScannerViewController, coordinator: Coordinator) {
        controller.stopScanning()
    }

    func makeCoordinator() -> Coordinator { Coordinator(onFound: onFound) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onFound: (String) -> Void
        init(onFound: @escaping (String) -> Void) { self.onFound = onFound }

        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            for item in items {
                if case .barcode(let code) = item, let value = code.payloadStringValue,
                   (try? PairingLink.parse(value)) != nil {
                    onFound(value)
                    return
                }
            }
        }
    }
}
