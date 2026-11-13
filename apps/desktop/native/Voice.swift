import Foundation
import AVFoundation
import Speech

// This helper owns one bounded microphone session, not a conversational agent.
// `--listen` captures a short companion command; `--dictate` captures free text
// for the composer, streaming partial results. Both stay on this device.
func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value), let line = String(data: data, encoding: .utf8) {
        print(line)
        fflush(stdout)
    }
}

let dictating = CommandLine.arguments.contains("--dictate")
// Dictation follows the system language when it can be recognized on device.
let recognizer: SFSpeechRecognizer? = {
    if dictating, let local = SFSpeechRecognizer(), local.supportsOnDeviceRecognition { return local }
    return SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
}()
let limitSeconds = dictating ? 120.0 : 10.0
let textLimit = dictating ? 8000 : 256
if CommandLine.arguments.contains("--check") {
    emit(["type": "capability", "available": recognizer?.supportsOnDeviceRecognition == true])
    exit(0)
}
guard CommandLine.arguments.contains("--listen") || dictating else { exit(2) }

final class Capture {
    let engine = AVAudioEngine()
    let request = SFSpeechAudioBufferRecognitionRequest()
    var task: SFSpeechRecognitionTask?
    var tapped = false
    var finished = false
    var ending = false
    var latest = ""
    var lastLevel = Date.distantPast

    func finish(_ message: [String: Any]) {
        guard !finished else { return }
        finished = true
        engine.stop()
        if tapped { engine.inputNode.removeTap(onBus: 0) }
        request.endAudio()
        task?.cancel()
        emit(message)
        exit(0)
    }
    func end() {
        guard !finished && !ending else { return }
        guard tapped else { finish(["type": "cancelled"]); return }
        ending = true
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        tapped = false
        request.endAudio()
        // A recognizer can fail to deliver a final callback after silence.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.finish(["type": "result", "text": self.latest]) }
    }
    func start() {
        guard let recognizer = recognizer, recognizer.supportsOnDeviceRecognition else {
            finish(["type": "error", "settings": "dictation", "message": dictating
                ? "On-device speech recognition is unavailable. Turn on Dictation in macOS Keyboard settings so the language downloads, then try again."
                : "On-device English speech is unavailable. Enable English Dictation in macOS settings and try again."])
            return
        }
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        if dictating {
            if #available(macOS 13, *) { request.addsPunctuation = true }
        } else {
            request.contextualStrings = ["Capsule", "dance", "bounce", "show my tasks", "read status", "pause motion", "wake up"]
        }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 && format.channelCount > 0 else {
            finish(["type": "error", "settings": "microphone", "message": "No microphone is available."])
            return
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            self.request.append(buffer)
            if dictating { self.meter(buffer) }
        }
        tapped = true
        task = recognizer.recognitionTask(with: request) { result, error in
            DispatchQueue.main.async {
                if let result = result {
                    let text = String(result.bestTranscription.formattedString.prefix(textLimit))
                    if result.isFinal { self.latest = text; self.finish(["type": "result", "text": text]); return }
                    if dictating && text != self.latest && !self.ending { emit(["type": "partial", "text": text]) }
                    self.latest = text
                }
                if error != nil { self.finish(["type": "error", "message": "Speech recognition stopped. Check the microphone and try again."]) }
            }
        }
        do {
            engine.prepare()
            try engine.start()
            emit(["type": "listening", "limitMs": Int(limitSeconds * 1000)])
            DispatchQueue.main.asyncAfter(deadline: .now() + limitSeconds) { self.end() }
        } catch { finish(["type": "error", "settings": "microphone", "message": "Could not start the microphone."]) }
    }
    // A coarse input level so the person can see the microphone hears them.
    func meter(_ buffer: AVAudioPCMBuffer) {
        guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
        var sum: Float = 0
        for index in 0..<Int(buffer.frameLength) { sum += samples[index] * samples[index] }
        let level = min(1, sqrt(sum / Float(buffer.frameLength)) * 8)
        DispatchQueue.main.async {
            guard !self.finished && !self.ending, Date().timeIntervalSince(self.lastLevel) >= 0.12 else { return }
            self.lastLevel = Date()
            emit(["type": "level", "value": (Double(level) * 100).rounded() / 100])
        }
    }
}

let capture = Capture()
DispatchQueue.global().async {
    while let command = readLine() {
        DispatchQueue.main.async {
            if command == "finish" { capture.end() }
            else { capture.finish(["type": "cancelled"]) }
        }
    }
    DispatchQueue.main.async { capture.finish(["type": "cancelled"]) }
}
DispatchQueue.main.asyncAfter(deadline: .now() + limitSeconds + 30) { capture.finish(["type": "error", "message": "Voice input timed out."]) }
SFSpeechRecognizer.requestAuthorization { authorization in
    DispatchQueue.main.async {
        guard authorization == .authorized else {
            capture.finish(["type": "error", "settings": "speech", "message": "Allow Speech Recognition for Capsule in macOS Privacy & Security settings."])
            return
        }
        AVCaptureDevice.requestAccess(for: .audio) { allowed in
            DispatchQueue.main.async {
                if allowed { capture.start() }
                else { capture.finish(["type": "error", "settings": "microphone", "message": "Allow Microphone access for Capsule in macOS Privacy & Security settings."]) }
            }
        }
    }
}
RunLoop.main.run()
