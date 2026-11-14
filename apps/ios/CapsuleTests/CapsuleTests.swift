import Foundation
import Testing
@testable import Capsule

@Suite("Pairing links")
struct PairingLinkTests {
    let fp = String(repeating: "ab", count: 32)

    @Test func pinnedCodeCarriesFingerprintAndName() throws {
        let link = try PairingLink.parse("capsule://pair?host=192.168.1.20&port=51102&fp=\(fp)&token=tok123&name=Studio")
        #expect(link.host == "192.168.1.20")
        #expect(link.port == 51102)
        #expect(link.token == "tok123")
        #expect(link.hostName == "Studio")
        #expect(link.security == .pinned(fingerprint: fp))
        #expect(link.baseURL.absoluteString == "https://192.168.1.20:51102")
    }

    @Test func formEncodedNameDecodesSpaces() throws {
        let link = try PairingLink.parse("capsule://pair?host=h&port=1&fp=\(fp)&token=t&name=Sam%E2%80%99s+MacBook+Air")
        #expect(link.hostName == "Sam\u{2019}s MacBook Air")
    }

    @Test func fingerprintWithColonsAndCapitalsIsNormalised() throws {
        let colons = stride(from: 0, to: 64, by: 2).map { i in
            String(fp.uppercased()[fp.index(fp.startIndex, offsetBy: i)..<fp.index(fp.startIndex, offsetBy: i + 2)])
        }.joined(separator: ":")
        let link = try PairingLink.parse("capsule://pair?host=h&port=1&fp=\(colons)&token=t")
        #expect(link.security == .pinned(fingerprint: fp))
    }

    @Test func browserLinkIsPlaintext() throws {
        let link = try PairingLink.parse("  http://127.0.0.1:51101/#pair=zh9C7r5kJKkIcaOheXX48keKOv0\n")
        #expect(link.security == .plaintext)
        #expect(link.token == "zh9C7r5kJKkIcaOheXX48keKOv0")
        #expect(link.port == 51101)
    }

    @Test func httpsLinkUsesSystemTrust() throws {
        let link = try PairingLink.parse("https://capsule.example.net/#pair=abc")
        #expect(link.security == .systemTLS)
        #expect(link.port == 443)
    }

    @Test(arguments: [
        ("https://example.com", PairingLink.ParseError.notAPairingLink),
        ("http://127.0.0.1:5/#pair=", .missingToken),
        ("capsule://pair?host=h&port=1&fp=abc&token=t", .badFingerprint),
        ("capsule://pair?host=h&port=99999&fp=\(String(repeating: "a", count: 64))&token=t", .badHost),
        ("capsule://pair?host=h&port=1&fp=\(String(repeating: "a", count: 64))", .missingToken),
        ("capsule://settings", .notAPairingLink),
        ("not a link", .notAPairingLink),
    ])
    func rejectsWhatIsNotAPairing(_ input: String, _ expected: PairingLink.ParseError) {
        #expect(throws: expected) { try PairingLink.parse(input) }
    }
}

@Suite("Wire models")
struct ModelTests {
    @Test func decodesThreadIgnoringUnknownFields() throws {
        let json = #"{"id":"s1","workspaceId":"w","projectId":"p","agentId":"codex","title":"Fix","mode":"code","state":"active","brandNew":{"x":1},"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-02T00:00:00.000Z"}"#
        let thread = try JSONDecoder().decode(ChatThread.self, from: Data(json.utf8))
        #expect(thread.title == "Fix")
        #expect(!thread.isArchived)
    }

    @Test func runChannelDistinguishesRunsFromEvents() throws {
        let event = #"{"id":"e","runId":"r","timestamp":"t","type":"tool","message":"ls","data":{"toolCallId":"c","status":"completed"}}"#
        let run = #"{"id":"r","sessionId":"s","status":"approval_required","createdAt":"a","updatedAt":"b"}"#
        #expect(throws: Never.self) { try JSONDecoder().decode(RunEvent.self, from: Data(event.utf8)) }
        #expect(throws: (any Error).self) { try JSONDecoder().decode(RunEvent.self, from: Data(run.utf8)) }
        let decoded = try JSONDecoder().decode(Run.self, from: Data(run.utf8))
        #expect(decoded.status == .approvalRequired)
        #expect(decoded.status.isLive)
    }

    @Test func timestampsWithAndWithoutFractions() {
        #expect(Timestamp.date("2026-11-14T10:00:00.123Z") != nil)
        #expect(Timestamp.date("2026-11-14T10:00:00Z") != nil)
        #expect(Timestamp.date("yesterday") == nil)
    }
}

@Suite("Transcript")
struct TranscriptTests {
    func event(_ id: String, call: String, status: String?, title: String? = nil, kind: String? = nil) -> RunEvent {
        var data: [String: JSONValue] = ["toolCallId": .string(call)]
        if let status { data["status"] = .string(status) }
        if let title { data["title"] = .string(title) }
        if let kind { data["kind"] = .string(kind) }
        return RunEvent(id: id, runId: "r", sessionId: nil, timestamp: id, type: "tool", message: title ?? "", data: .object(data))
    }

    @Test func toolUpdatesFoldIntoOneStep() {
        let steps = ToolStep.fold([
            event("1", call: "a", status: nil, title: "npm test", kind: "execute"),
            event("2", call: "a", status: "in_progress"),
            event("3", call: "b", status: nil, title: "README.md", kind: "read"),
            event("4", call: "a", status: "failed"),
        ])
        #expect(steps.count == 2)
        #expect(steps[0].title == "npm test")
        #expect(steps[0].kind == "execute")
        #expect(steps[0].state == .failed)
        #expect(steps[1].state == .running)
    }

    @Test func liveReplyAcceptsDeltasAndSnapshots() {
        let model = ThreadModel(threadID: "s")
        func reply(_ text: String) -> RunEvent {
            RunEvent(id: UUID().uuidString, runId: "r", sessionId: "s", timestamp: "t", type: "assistant", message: text, data: nil)
        }
        model.apply(event: reply("Hel"))
        model.apply(event: reply("lo"))
        #expect(model.replies["r"]?.text == "Hello")
        model.apply(event: reply("Hello, world"))
        #expect(model.replies["r"]?.text == "Hello, world")
    }

    @Test(arguments: [("read_file", "read"), ("run_terminal_command", "execute"), ("edit_file", "edit"), ("grep_search", "search"), ("mystery", nil)])
    func toolNamesImplyKinds(_ name: String, _ kind: String?) {
        #expect(ToolStep.inferKind(name) == kind)
    }

    @Test(arguments: [
        ("/bin/zsh -lc \"git status --short\"", "git status --short"),
        ("/bin/bash -lc 'ls -la'", "ls -la"),
        ("npm test", "npm test"),
    ])
    func shellWrapperIsRemoved(_ raw: String, _ expected: String) {
        #expect(ToolStep.unwrapShell(raw) == expected)
    }

    @Test func stepsCarryInputAndOutput() {
        let direct = RunEvent(id: "1", runId: "r", sessionId: nil, timestamp: "1", type: "tool", message: "",
                              data: .object(["toolCallId": .string("a"), "kind": .string("execute"), "title": .string("ls"),
                                             "status": .string("completed"),
                                             "details": .object(["input": .string("ls -la"), "output": .string("a\nb"), "truncated": .bool(true)])]))
        let gateway = RunEvent(id: "2", runId: "r", sessionId: nil, timestamp: "2", type: "tool", message: "",
                               data: .object(["toolCallId": .string("b"), "status": .string("completed"), "title": .string("tool call"),
                                              "data": .object(["text": .string("tool call (completed): ```console\nhello\n```")])]))
        let steps = ToolStep.fold([direct, gateway])
        #expect(steps[0].input == "ls -la")
        #expect(steps[0].output == "a\nb")
        #expect(steps[0].outputTruncated)
        #expect(steps[1].output == "hello")
    }

    @Test func eachTurnHasItsOwnLog() {
        let model = ThreadModel(threadID: "s")
        model.apply(runs: [Run(id: "a", sessionId: "s", status: .completed, createdAt: "1", updatedAt: "1"),
                           Run(id: "b", sessionId: "s", status: .running, createdAt: "2", updatedAt: "2")])
        let before = model.logs["a"]
        model.apply(event: RunEvent(id: "e", runId: "b", sessionId: "s", timestamp: "3", type: "tool", message: "ls", data: nil))
        #expect(model.logs["b"]?.events.count == 1)
        #expect(model.logs["a"]?.events.isEmpty == true)
        #expect(model.logs["a"] === before)
    }

    @Test func workLogFollowsItsPrompt() {
        let user = ChatMessage(id: "m1", sessionId: "s", role: .user, content: "go", runId: "r", createdAt: "1")
        let reply = ChatMessage(id: "m2", sessionId: "s", role: .assistant, content: "done", runId: "r", createdAt: "2")
        let run = Run(id: "r", sessionId: "s", status: .completed, createdAt: "1", updatedAt: "2")
        let items = TranscriptItem.build(messages: [user, reply], runs: ["r": run], streaming: [], hasOlder: true)
        #expect(items.map(\.id).filter { !$0.hasPrefix("d-") } == ["older", "m-m1", "w-r", "m-m2"])
    }
}

@Suite("Rendering")
struct RenderingTests {
    @Test func markdownBlocks() {
        let blocks = MarkdownBlock.parse("""
        # Title
        Some **bold** text
        continues here.

        - one
          - nested
        1. first
        > quoted
        ```swift
        let x = 1

        print(x)
        ```
        ---
        """)
        let kinds = blocks.map(\.kind)
        #expect(kinds[0] == .heading(1, "Title"))
        #expect(kinds[1] == .paragraph("Some **bold** text continues here."))
        #expect(kinds[2] == .listItem(marker: "•", depth: 0, "one"))
        #expect(kinds[3] == .listItem(marker: "•", depth: 1, "nested"))
        #expect(kinds[4] == .listItem(marker: "1.", depth: 0, "first"))
        #expect(kinds[5] == .quote("quoted"))
        #expect(kinds[6] == .code("swift", "let x = 1\n\nprint(x)"))
        #expect(kinds[7] == .rule)
    }

    @Test func tablesNeedAHeaderSeparator() {
        let table = MarkdownBlock.parse("Intro\n| PR | Title |\n|---|:--|\n| #1 | Fix |\n| #2 | Add |\nAfter")
        #expect(table.map(\.kind) == [
            .paragraph("Intro"),
            .table(header: ["PR", "Title"], rows: [["#1", "Fix"], ["#2", "Add"]]),
            .paragraph("After"),
        ])
        let notTable = MarkdownBlock.parse("| just | bars |")
        #expect(notTable.map(\.kind) == [.paragraph("| just | bars |")])
    }

    @Test func hardBreaksSurvive() {
        #expect(MarkdownBlock.parse("one\\\ntwo  \nthree").map(\.kind) == [.paragraph("one\ntwo three")])
    }

    @Test func windowsLineEndingsAreSoftBreaks() {
        #expect(MarkdownBlock.parse("any new\r\npull requests.").map(\.kind) == [.paragraph("any new pull requests.")])
    }

    @Test func imageLinesBecomeImageBlocks() {
        #expect(MarkdownBlock.parse("![chart](https://x.dev/a.png)").map(\.kind) == [.image(alt: "chart", url: "https://x.dev/a.png")])
        #expect(MarkdownBlock.parse("see ![a](b) inline").map(\.kind) == [.paragraph("see ![a](b) inline")])
    }

    @Test func unterminatedFenceStillShowsCode() {
        let blocks = MarkdownBlock.parse("```\nstreaming…")
        #expect(blocks.map(\.kind) == [.code(nil, "streaming…")])
    }

    @Test func wordChangesArePaired() {
        let diff = UnifiedDiff.parse("""
        diff --git a/a.swift b/a.swift
        --- a/a.swift
        +++ b/a.swift
        @@ -1,1 +1,1 @@
        -let timeout = 30
        +let timeout = 45
        """)
        let lines = diff.files[0].lines.filter { $0.kind == .removed || $0.kind == .added }
        #expect(lines[0].changed == [14..<16])
        #expect(lines[1].changed == [14..<16])
    }

    @Test(arguments: [(44, 4, 4, 1), (38, 0, 5, 0), (0, 3, 0, 5), (1, 1, 3, 2), (0, 0, 0, 0)])
    func changeBarShowsBothSides(_ added: Int, _ removed: Int, _ green: Int, _ red: Int) {
        let blocks = ChangeBar.blocks(added: added, removed: removed)
        #expect(blocks.green == green)
        #expect(blocks.red == red)
    }

    @Test func pairingSkipsInsertedLines() {
        let diff = UnifiedDiff.parse("""
        diff --git a/a.swift b/a.swift
        --- a/a.swift
        +++ b/a.swift
        @@ -1,2 +1,4 @@
        -HourlyList(hours: forecast.hours)
        -    .frame(height: 220)
        +if showList {
        +    HourlyList(hours: forecast.hours)
        +} else {
        +    HourlyChart(hours: forecast.hours)
        """)
        let lines = diff.files[0].lines
        // `.frame(height: 220)` has no counterpart, so nothing in it is marked.
        #expect(lines.first { $0.text.contains(".frame") }?.changed.isEmpty == true)
        #expect(lines.first { $0.text == "if showList {" }?.changed.isEmpty == true)
    }

    @Test func unrelatedLinesStayPlain() {
        #expect(UnifiedDiff.wordDiff("import Foundation", "return a + b * c") == nil)
    }

    @Test func unifiedDiffNumbersLines() {
        let diff = UnifiedDiff.parse("""
        diff --git a/src/a.ts b/src/a.ts
        index 1..2 100644
        --- a/src/a.ts
        +++ b/src/a.ts
        @@ -10,3 +10,4 @@ function x()
         keep
        -old
        +new
        +more
        diff --git a/img.png b/img.png
        Binary files a/img.png and b/img.png differ
        """)
        #expect(diff.files.count == 2)
        let file = diff.files[0]
        #expect(file.path == "src/a.ts")
        #expect(file.added == 2)
        #expect(file.removed == 1)
        #expect(file.lines.first { $0.kind == .removed }?.oldNumber == 11)
        #expect(file.lines.last?.newNumber == 12)
        #expect(diff.files[1].isBinary)
    }
}

@Suite("Connection")
struct ConnectionTests {
    @Test func backoffGrowsAndCaps() {
        #expect((1.2...1.8).contains(Connection.backoff(failures: 0)))
        #expect(Connection.backoff(failures: 10) <= 36)
        #expect(Connection.backoff(failures: 10) >= 24)
    }
}

@Suite("Dates")
struct DateTests {
    @Test func dayKeysFollowTheLocalCalendar() {
        let now = Date.now
        let iso = now.formatted(.iso8601)
        let c = Calendar.current.dateComponents([.year, .month, .day], from: now)
        #expect(iso.dayKey == String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!))
        #expect(DateKey.date(iso.dayKey!).map { Calendar.current.isDateInToday($0) } == true)
        #expect("nonsense".dayKey == nil)
    }

    @Test func daySeparatorsAppearWhenTheDayChanges() {
        let a = ChatMessage(id: "a", sessionId: "s", role: .user, content: "x", createdAt: "2026-01-01T10:00:00Z")
        let b = ChatMessage(id: "b", sessionId: "s", role: .assistant, content: "y", createdAt: "2026-01-01T10:05:00Z")
        let c = ChatMessage(id: "c", sessionId: "s", role: .user, content: "z", createdAt: "2026-01-05T10:00:00Z")
        let ids = TranscriptItem.build(messages: [a, b, c], runs: [:], streaming: [], hasOlder: false).map(\.id)
        #expect(ids.filter { $0.hasPrefix("d-") }.count == 2)
        #expect(ids.firstIndex(of: "m-c")! > ids.lastIndex { $0.hasPrefix("d-") }!)
    }
}

@Suite("Sample workspace")
@MainActor
struct SampleWorkspaceTests {
    @Test func threadActionsAndTheirUndo() async throws {
        let workspace = Workspace(preview: true)
        workspace.startSample()
        let thread = try #require(workspace.thread(SampleData.docsThread))
        try await workspace.setArchived(thread, true)
        #expect(workspace.thread(SampleData.docsThread)?.isArchived == true)
        // Undo replays the reverse with the thread as it was before.
        try await workspace.setArchived(thread, thread.isArchived)
        #expect(workspace.thread(SampleData.docsThread)?.isArchived == false)
        try await workspace.rename(thread, to: "Caching, explained")
        #expect(workspace.thread(SampleData.docsThread)?.title == "Caching, explained")
        try await workspace.setPinned(thread, true)
        #expect(workspace.thread(SampleData.docsThread)?.pinned == true)
    }

    @Test func approvingSettlesTheSampleRun() async throws {
        let workspace = Workspace(preview: true)
        workspace.startSample()
        #expect(workspace.pendingApprovals.count == 1)
        try await workspace.resolve(approvalID: SampleData.approvalID, .once)
        #expect(workspace.pendingApprovals.isEmpty)
        #expect(workspace.latestRuns[SampleData.testsThread]?.status == .completed)
    }

    @Test func searchFindsSampleMessages() async throws {
        let workspace = Workspace(preview: true)
        workspace.startSample()
        let hits = try await workspace.searchMessages("ten minutes")
        #expect(hits.map(\.sessionId) == [SampleData.docsThread])
    }
}

@Suite("Supervision")
@MainActor
struct SupervisionTests {
    @Test func lockScreenShowsTheCommandNotTheFolder() {
        #expect(Workspace.approvalDetail(SampleData.approval) == "npm test -- dates")
    }

    @Test func shellWrapperIsDroppedFromTheRequest() {
        var approval = SampleData.approval
        approval.details = .object(["rawInput": .object(["command": .string("/bin/zsh -lc \"git push\"")])])
        #expect(Workspace.approvalDetail(approval) == "git push")
    }

    @Test func requestWithoutACommandFallsBackToItsTarget() {
        var approval = SampleData.approval
        approval.details = nil
        #expect(Workspace.approvalDetail(approval) == "~/Projects/weather-app")
    }

    @Test func widgetSnapshotRoundTrips() throws {
        let data = try JSONEncoder().encode(WidgetSnapshot.placeholder)
        let decoded = try JSONDecoder().decode(WidgetSnapshot.self, from: data)
        #expect(decoded.items.map(\.id) == ["a", "b"])
        #expect(decoded.needsYou == 1)
    }
}

@Suite("Syntax colour")
struct SyntaxTests {
    private func kinds(_ code: String, _ language: String) -> [(SyntaxHighlighter.Kind, String)] {
        let lang = try! #require(SyntaxHighlighter.language(language))
        let utf16 = Array(code.utf16)
        return SyntaxHighlighter.spans(code, lang).map { ($0.kind, String(decoding: utf16[$0.range], as: UTF16.self)) }
    }

    @Test func swiftKeywordsStringsAndComments() {
        let result = kinds("let name = \"a // b\" // note", "swift")
        #expect(result.map(\.0) == [.keyword, .string, .comment])
        #expect(result[1].1 == "\"a // b\"")
        #expect(result[2].1 == "// note")
    }

    @Test func escapedQuoteStaysInTheString() {
        #expect(kinds(#"x = "say \"hi\"" + 1"#, "js").map(\.1) == [#""say \"hi\"""#, "1"])
    }

    @Test func hashInsideAWordIsNotAComment() {
        #expect(kinds("echo a#b # done", "sh").map(\.1) == ["echo", "# done"])
    }

    @Test func unknownLanguageStaysPlain() {
        #expect(SyntaxHighlighter.language("brainfuck") == nil)
        #expect(SyntaxHighlighter.language(nil) == nil)
    }
}

@Suite("Ask about lines")
struct AskAboutLinesTests {
    @Test func quotesTheRangeAsADiff() throws {
        let patch = """
        diff --git a/Forecast.swift b/Forecast.swift
        --- a/Forecast.swift
        +++ b/Forecast.swift
        @@ -10,3 +10,3 @@
         let a = 1
        -let b = 2
        +let b = 3
        """
        let file = try #require(UnifiedDiff.parse(patch).files.first)
        let text = PatchLines.quote(file, 1...3)
        #expect(text.hasPrefix("`Forecast.swift` lines 10–11:"))
        #expect(text.contains("```diff\n let a = 1\n-let b = 2\n+let b = 3\n```"))
    }
}

@Suite("Sharing into Capsule")
struct ShareTests {
    @Test func messageJoinsTextAndLink() {
        let item = SharedItem(id: "x", text: "  Look at this ", url: "https://example.com", images: [], createdAt: .now)
        #expect(item.message == "Look at this\n\nhttps://example.com")
        let linkOnly = SharedItem(id: "y", text: "", url: "https://example.com", images: [], createdAt: .now)
        #expect(linkOnly.message == "https://example.com")
    }

    @Test @MainActor func sampleThreadsOfferAgentCommands() async {
        let workspace = Workspace(preview: true)
        workspace.startSample()
        let commands = await workspace.agentCommands(threadID: SampleData.testsThread)
        #expect(commands.map(\.name) == ["compact", "review"])
    }
}

@Suite("While you were away")
@MainActor
struct BriefTests {
    @Test func headlineSkipsOpenersAndMarkdown() {
        #expect(Brief.headline("Done. The hourly forecast is now a **line chart**. Tap Changes.") == "The hourly forecast is now a line chart.")
        #expect(Brief.headline("## Summary\nFixed the `DayBoundary` check.") == "Fixed the DayBoundary check.")
        #expect(Brief.headline("```swift\nlet a = 1\n```") == nil)
    }

    @Test func sampleBriefPutsWhatNeedsYouFirst() throws {
        let workspace = Workspace(preview: true)
        workspace.startSample()
        let brief = try #require(workspace.brief())
        #expect(brief.items.first?.outcome == .needsYou)
        #expect(brief.items.contains { $0.threadID == SampleData.weatherThread && $0.outcome == .finished })
        workspace.dismissBrief()
        #expect(workspace.brief() == nil)
    }
}

@Suite("Harness marks")
struct HarnessTests {
    @Test func variantsWearTheirProductsMark() {
        #expect(Harness("claude-code")?.markKey == "claude")
        #expect(Harness("gemini-flash")?.markKey == "gemini")
        #expect(Harness("grok-build")?.markKey == "grok")
        #expect(Harness(name: "Claude Code")?.markKey == "claude")
        #expect(Harness(nil) == nil)
    }

    @Test func agentsWithoutAMarkGetAMonogram() {
        let aider = Harness("aider")
        #expect(aider?.markKey == nil)
        #expect(aider?.initials == "AI")
        #expect(Harness(name: "Open Interpreter")?.initials == "OI")
    }

    @Test func darkBrandColoursFallBackToText() {
        #expect(Harness("claude")?.accent != nil)
        #expect(Harness("codex")?.accent == nil)
    }
}

@Suite("Backdrop")
struct BackdropTests {
    private func hex(_ s: String) -> RGB {
        let v = UInt32(s.dropFirst(), radix: 16)!
        return RGB(r: Double((v >> 16) & 0xFF) / 255, g: Double((v >> 8) & 0xFF) / 255, b: Double(v & 0xFF) / 255)
    }

    // Same cases as packages/shared/src/backdrop.test.ts on the desktop.
    @Test func keepsTheChosenDimWhenAlreadyReadable() {
        for scene in Backdrop.Scene.allCases {
            #expect(Backdrop.scrim(text: hex("#F2F2F2"), base: hex("#0A0A0A"), scene: scene, opacity: 1, dim: 0) == 0)
            #expect(Backdrop.scrim(text: hex("#161614"), base: hex("#F4F4F1"), scene: scene, opacity: 1, dim: 0.35) == 0.35)
        }
    }

    @Test func asksNoMoreThanTheBareTheme() {
        #expect(Backdrop.scrim(text: hex("#777777"), base: hex("#555555"), scene: .dots, opacity: 1, dim: 0) <= 1)
        #expect(Backdrop.scrim(text: hex("#F2F2F2"), base: hex("#0A0A0A"), scene: .dots, opacity: 0, dim: 0) == 0)
    }

    @Test func readsScenesAndIgnoresImages() throws {
        let json = #"{"themes":{"backdrop":{"light":{"scene":"mesh","opacity":0.8,"blur":4,"dim":0.2,"fit":"cover"},"dark":{"imageUrl":"capsule-backdrop://x","fit":"cover","opacity":1,"blur":0,"dim":0}}},"settings":{}}"#
        let slice = try JSONDecoder().decode(ConfigSnapshotSlice.self, from: Data(json.utf8))
        #expect(slice.backdrops.light == Backdrop(scene: .mesh, opacity: 0.8, blur: 4, dim: 0.2))
        #expect(slice.backdrops.dark == nil)
    }
}
