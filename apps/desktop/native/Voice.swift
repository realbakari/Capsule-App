import Foundation
import AVFoundation
import Speech

// This helper owns one bounded microphone session, not a conversational agent.
func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value), let line = String(data: data, encoding: .utf8) {
        print(line)
        fflush(stdout)
    }
}

let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
if CommandLine.arguments.contains("--check") {
    emit(["type": "capability", "available": recognizer?.supportsOnDeviceRecognition == true])
    exit(0)
}
guard CommandLine.arguments.contains("--listen") else { exit(2) }

final class Capture {
    let engine = AVAudioEngine()
    let request = SFSpeechAudioBufferRecognitionRequest()
    var task: SFSpeechRecognitionTask?
    var tapped = false
    var finished = false
    var ending = false
    var latest = ""

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
            finish(["type": "error", "message": "On-device English speech is unavailable. Enable English Dictation in macOS settings and try again."])
            return
        }
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        request.contextualStrings = ["Capsule", "dance", "bounce", "show my tasks", "read status", "pause motion", "wake up"]
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 && format.channelCount > 0 else {
            finish(["type": "error", "message": "No microphone is available."])
            return
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in self.request.append(buffer) }
        tapped = true
        task = recognizer.recognitionTask(with: request) { result, error in
            DispatchQueue.main.async {
                if let result = result {
                    self.latest = String(result.bestTranscription.formattedString.prefix(256))
                    if result.isFinal { self.finish(["type": "result", "text": self.latest]); return }
                }
                if error != nil { self.finish(["type": "error", "message": "Speech recognition stopped. Check the microphone and try again."]) }
            }
        }
        do {
            engine.prepare()
            try engine.start()
            emit(["type": "listening"])
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) { self.end() }
        } catch { finish(["type": "error", "message": "Could not start the microphone."]) }
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
DispatchQueue.main.asyncAfter(deadline: .now() + 40) { capture.finish(["type": "error", "message": "Voice input timed out."]) }
SFSpeechRecognizer.requestAuthorization { authorization in
    DispatchQueue.main.async {
        guard authorization == .authorized else {
            capture.finish(["type": "error", "message": "Allow Speech Recognition for Capsule in macOS Privacy & Security settings."])
            return
        }
        AVCaptureDevice.requestAccess(for: .audio) { allowed in
            DispatchQueue.main.async {
                if allowed { capture.start() }
                else { capture.finish(["type": "error", "message": "Allow Microphone access for Capsule in macOS Privacy & Security settings."]) }
            }
        }
    }
}
RunLoop.main.run()
