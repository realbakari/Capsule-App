import SwiftUI
import UIKit
import UniformTypeIdentifiers

/*
 * "Capsule" in the share sheet. Collects the text, link and photos, keeps
 * them for the app, and says where they'll show up. Nothing leaves the
 * phone here: the app sends them to your computer once you pick a project.
 */
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let model = ShareModel(context: extensionContext)
        let host = UIHostingController(rootView: ShareView(model: model))
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
        Task { await model.load() }
    }
}

@Observable
final class ShareModel {
    enum State: Equatable { case loading, ready, saved, failed(String) }

    var state: State = .loading
    var text = ""
    var url: String?
    var images: [UIImage] = []

    private weak var context: NSExtensionContext?

    init(context: NSExtensionContext?) { self.context = context }

    func load() async {
        let providers = (context?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        var texts: [String] = []
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
               let value = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier),
               let link = value as? URL, link.scheme == "http" || link.scheme == "https" {
                url = link.absoluteString
            } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier), images.count < SharedInbox.maxImages {
                if let image = await Self.image(from: provider) { images.append(image) }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                      let value = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                texts.append(value)
            }
        }
        text = texts.joined(separator: "\n\n")
        state = text.isEmpty && url == nil && images.isEmpty ? .failed(String(localized: "There's nothing here Capsule can use.")) : .ready
    }

    func save() {
        let photos = images.compactMap { $0.reduced(toLongSide: 2048).jpegData(compressionQuality: 0.8) }
        do {
            _ = try SharedInbox.save(text: text, url: url, images: photos)
            state = .saved
        } catch {
            state = .failed(String(localized: "Couldn't save this for Capsule."))
        }
    }

    func finish() { context?.completeRequest(returningItems: nil) }

    func cancel() { context?.cancelRequest(withError: CocoaError(.userCancelled)) }

    private static func image(from provider: NSItemProvider) async -> UIImage? {
        await withCheckedContinuation { continuation in
            provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, _ in
                continuation.resume(returning: data.flatMap(UIImage.init(data:)))
            }
        }
    }
}

struct ShareView: View {
    @Bindable var model: ShareModel

    var body: some View {
        NavigationStack {
            Form {
                switch model.state {
                case .loading:
                    ProgressView().frame(maxWidth: .infinity)
                case .failed(let message):
                    Text(message).foregroundStyle(.secondary)
                case .ready, .saved:
                    Section {
                        TextField("Message", text: $model.text, axis: .vertical).lineLimit(3...10)
                        if let url = model.url {
                            Text(verbatim: url).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                        }
                        if !model.images.isEmpty {
                            ScrollView(.horizontal) {
                                HStack(spacing: 8) {
                                    ForEach(model.images.indices, id: \.self) { index in
                                        Image(uiImage: model.images[index]).resizable().scaledToFill()
                                            .frame(width: 64, height: 64).clipShape(.rect(cornerRadius: 10))
                                            .accessibilityLabel(Text("Photo \(index + 1)"))
                                    }
                                }
                            }
                        }
                    } footer: {
                        if model.state == .saved {
                            Label("Open Capsule to choose a project and start the thread.", systemImage: "checkmark.circle.fill")
                                .foregroundStyle(Color("Primary"))
                        } else {
                            Text("Capsule keeps this on your phone until you open the app, pick a project and start the thread. Nothing is sent until then.")
                        }
                    }
                }
            }
            .navigationTitle("New thread")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if model.state != .saved { Button("Cancel") { model.cancel() } }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if model.state == .saved {
                        Button("Done") { model.finish() }
                    } else {
                        Button("Save") { model.save() }.disabled(model.state != .ready)
                    }
                }
            }
        }
        .tint(Color("Primary"))
    }
}

private extension UIImage {
    func reduced(toLongSide limit: CGFloat) -> UIImage {
        let long = max(size.width, size.height)
        guard long > limit else { return self }
        let scale = limit / long
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
    }
}
