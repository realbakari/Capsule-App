import AVFoundation
import Observation
import Speech

/*
 * The composer's microphone. Speech is transcribed on the device, never sent
 * anywhere, and the words land in the draft for you to edit and send yourself.
 *
 * The microphone tap feeds a converter into the analyzer's preferred format.
 * Volatile (in-progress) text shows as it's heard and is replaced by the
 * final text for the same stretch of audio.
 */
@Observable
final class Dictation {
    enum State: Equatable { case idle, preparing, listening, failed(String) }

    private(set) var state: State = .idle
    /// Final text so far, plus the volatile tail.
    private(set) var finalText = ""
    private(set) var volatileText = ""
    /// 0…1, for the level meter.
    private(set) var level: Float = 0

    var transcript: String { (finalText + volatileText).trimmingCharacters(in: .whitespaces) }
    var isActive: Bool { state == .preparing || state == .listening }

    @ObservationIgnored private var engine: AVAudioEngine?
    @ObservationIgnored private var analyzer: SpeechAnalyzer?
    @ObservationIgnored private var input: AsyncStream<AnalyzerInput>.Continuation?
    @ObservationIgnored private var tasks: [Task<Void, Never>] = []

    func start() async {
        guard !isActive else { return }
        finalText = ""; volatileText = ""; level = 0
        state = .preparing
        guard await AVAudioApplication.requestRecordPermission() else {
            state = .failed(String(localized: "Allow the microphone for Capsule in Settings to dictate."))
            return
        }
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: .current) else {
            state = .failed(String(localized: "Dictation isn't available in your language on this device."))
            return
        }
        let transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults], attributeOptions: [])
        do {
            if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                try await request.downloadAndInstall()
            }
            guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
                throw DictationError.noFormat
            }
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let (stream, continuation) = AsyncStream.makeStream(of: AnalyzerInput.self)
            input = continuation
            let analyzer = SpeechAnalyzer(modules: [transcriber])
            self.analyzer = analyzer

            tasks.append(Task { [weak self] in
                do {
                    for try await result in transcriber.results {
                        let text = String(result.text.characters)
                        if result.isFinal {
                            self?.finalText += text
                            self?.volatileText = ""
                        } else {
                            self?.volatileText = text
                        }
                    }
                } catch {
                    if self?.isActive == true { self?.state = .failed(String(localized: "Dictation stopped.")) }
                }
            })

            let engine = AVAudioEngine()
            let node = engine.inputNode
            let micFormat = node.outputFormat(forBus: 0)
            guard let converter = AVAudioConverter(from: micFormat, to: format) else { throw DictationError.noFormat }
            node.installTap(onBus: 0, bufferSize: 4096, format: micFormat) { [weak self] buffer, _ in
                let level = Self.rms(buffer)
                guard let converted = Self.convert(buffer, with: converter, to: format) else { return }
                continuation.yield(AnalyzerInput(buffer: converted))
                Task { @MainActor in self?.level = level }
            }
            engine.prepare()
            try engine.start()
            self.engine = engine
            try await analyzer.start(inputSequence: stream)
            state = .listening
        } catch {
            teardown()
            state = .failed(String(localized: "Dictation couldn't start. Try the keyboard's microphone instead."))
        }
    }

    /// Stops listening and keeps what was heard.
    func stop() async {
        guard isActive else { return }
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        input?.finish()
        try? await analyzer?.finalizeAndFinishThroughEndOfInput()
        if !volatileText.isEmpty { finalText += volatileText; volatileText = "" }
        teardown()
        state = .idle
    }

    func cancel() {
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        input?.finish()
        Task { [analyzer] in await analyzer?.cancelAndFinishNow() }
        teardown()
        finalText = ""; volatileText = ""
        state = .idle
    }

    private func teardown() {
        tasks.forEach { $0.cancel() }
        tasks = []
        engine = nil; analyzer = nil; input = nil; level = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    enum DictationError: Error { case noFormat }

    nonisolated private static func convert(_ buffer: AVAudioPCMBuffer, with converter: AVAudioConverter, to format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let ratio = format.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1
        guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
        nonisolated(unsafe) var supplied = false
        var error: NSError?
        converter.convert(to: output, error: &error) { _, status in
            if supplied { status.pointee = .noDataNow; return nil }
            supplied = true
            status.pointee = .haveData
            return buffer
        }
        return error == nil && output.frameLength > 0 ? output : nil
    }

    nonisolated private static func rms(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let data = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<Int(buffer.frameLength) { sum += data[i] * data[i] }
        let rms = sqrt(sum / Float(buffer.frameLength))
        return min(1, max(0, (20 * log10(max(rms, 0.000_01)) + 50) / 50))
    }
}
