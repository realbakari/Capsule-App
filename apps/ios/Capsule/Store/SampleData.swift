import Foundation

/*
 * A small, made-up workspace for trying the app without a computer (and for
 * App Review). Everything here is local: nothing is sent anywhere, and the
 * "agent" only ever answers from this file.
 */
nonisolated enum SampleData {
    static let projectID = "sample-project"
    static let weatherThread = "sample-thread-weather"
    static let testsThread = "sample-thread-tests"
    static let docsThread = "sample-thread-docs"
    static let approvalID = "sample-approval"

    private static func ago(_ minutes: Double) -> String {
        Date.now.addingTimeInterval(-minutes * 60).formatted(.iso8601)
    }

    static var projects: [Project] {
        [Project(id: projectID, name: "weather-app", description: "A sample project", workingDirectory: nil, iconDataUrl: nil, updatedAt: ago(1))]
    }

    static var threads: [ChatThread] {
        [
            ChatThread(id: weatherThread, projectId: projectID, agentId: "codex", title: "Show the hourly forecast as a chart",
                       mode: "code", state: "active", harnessId: "codex", pinned: true, pinOrder: 0, createdAt: ago(40), updatedAt: ago(3)),
            ChatThread(id: testsThread, projectId: projectID, agentId: "claude", title: "Fix the flaky date tests",
                       mode: "code", state: "active", harnessId: "claude", pinned: false, pinOrder: nil, createdAt: ago(30), updatedAt: ago(1)),
            ChatThread(id: docsThread, projectId: projectID, agentId: "claude", title: "Explain how caching works",
                       mode: "research", state: "active", harnessId: "claude", pinned: false, pinOrder: nil, createdAt: ago(300), updatedAt: ago(240)),
        ]
    }

    static var runs: [Run] {
        [
            Run(id: "sample-run-weather", sessionId: weatherThread, projectId: projectID, agentId: "codex", status: .completed,
                prompt: nil, result: nil, error: nil, checkpointRef: "sample", createdAt: ago(5), updatedAt: ago(3), completedAt: ago(3)),
            Run(id: "sample-run-tests", sessionId: testsThread, projectId: projectID, agentId: "claude", status: .approvalRequired,
                prompt: nil, result: nil, error: nil, checkpointRef: nil, createdAt: ago(2), updatedAt: ago(1), completedAt: nil),
            Run(id: "sample-run-docs", sessionId: docsThread, projectId: projectID, agentId: "claude", status: .completed,
                prompt: nil, result: nil, error: nil, checkpointRef: nil, createdAt: ago(242), updatedAt: ago(240), completedAt: ago(240)),
        ]
    }

    static let commands = [
        AgentCommandInfo(name: "compact", description: "Summarize the conversation to free up context"),
        AgentCommandInfo(name: "review", description: "Review the changes on this branch"),
    ]

    static var approval: Approval {
        Approval(id: approvalID, runId: "sample-run-tests", agentId: "claude", agentName: "Claude Code", action: "Allow this command?",
                 target: "~/Projects/weather-app", reason: "The agent wants to run the test suite to confirm the fix.",
                 status: .pending, details: .object(["kind": .string("execute"), "rawInput": .object(["command": .string("npm test -- dates")])]),
                 createdAt: ago(1), resolvedAt: nil)
    }

    static func messages(for threadID: String) -> [ChatMessage] {
        switch threadID {
        case weatherThread:
            return [
                ChatMessage(id: "sm1", sessionId: threadID, role: .user, content: "Show the hourly forecast as a chart instead of a list.", runId: "sample-run-weather", createdAt: ago(5)),
                ChatMessage(id: "sm2", sessionId: threadID, role: .assistant, content: """
                Done. The hourly forecast is now a line chart.

                - **`HourlyChart.swift`** draws temperature with a shaded range for the low and high.
                - The list stays available behind a **Show as list** toggle, for VoiceOver.

                ```swift
                Chart(hours) { hour in
                    LineMark(x: .value("Hour", hour.time), y: .value("°C", hour.temperature))
                }
                ```

                Tap **Changes** to see the diff.
                """, runId: "sample-run-weather", createdAt: ago(3)),
            ]
        case testsThread:
            return [
                ChatMessage(id: "st1", sessionId: threadID, role: .user, content: "The date tests fail around midnight. Can you fix them?", runId: "sample-run-tests", createdAt: ago(2)),
            ]
        case docsThread:
            return [
                ChatMessage(id: "sd1", sessionId: threadID, role: .user, content: "How does caching work in this app?", runId: "sample-run-docs", createdAt: ago(242)),
                ChatMessage(id: "sd2", sessionId: threadID, role: .assistant, content: """
                Forecasts are cached for **ten minutes** per location.

                | Layer | Lifetime | Where |
                |---|---|---|
                | Memory | 10 min | `ForecastStore` |
                | Disk | 1 day | `Caches/forecasts` |

                A pull to refresh skips the memory cache but keeps the disk copy for offline use.
                """, runId: "sample-run-docs", createdAt: ago(240)),
            ]
        default:
            return []
        }
    }

    static func events(for runID: String) -> [RunEvent] {
        func tool(_ id: String, _ kind: String, _ title: String, _ output: String?, _ status: String = "completed") -> RunEvent {
            var details: [String: JSONValue] = ["input": .string(title)]
            if let output { details["output"] = .string(output) }
            return RunEvent(id: id, runId: runID, sessionId: nil, timestamp: id, type: "tool", message: title,
                            data: .object(["toolCallId": .string(id), "kind": .string(kind), "title": .string(title),
                                           "status": .string(status), "details": .object(details)]))
        }
        switch runID {
        case "sample-run-weather":
            return [
                tool("e1", "search", "rg -n \"HourlyList\" Sources", "Sources/Forecast/HourlyList.swift:12: struct HourlyList: View {"),
                tool("e2", "read", "Sources/Forecast/HourlyList.swift", nil),
                tool("e3", "edit", "Sources/Forecast/HourlyChart.swift", nil),
                tool("e4", "execute", "swift test", "Test Suite 'All tests' passed.\n  42 tests, 0 failures"),
            ]
        case "sample-run-tests":
            return [
                tool("t1", "read", "Tests/DateTests.swift", nil),
                tool("t2", "edit", "Sources/Dates/DayBoundary.swift", nil),
            ]
        default:
            return []
        }
    }

    static var diffSummary: TurnDiff {
        TurnDiff(patch: "", files: [
            .init(path: "Sources/Forecast/HourlyChart.swift", added: 38, removed: 0, status: "added"),
            .init(path: "Sources/Forecast/ForecastView.swift", added: 7, removed: 5, status: "modified"),
        ], patchTruncated: false, filesTruncated: false, available: true)
    }

    static func patch(for file: String) -> String {
        if file.hasSuffix("ForecastView.swift") {
            return """
            diff --git a/Sources/Forecast/ForecastView.swift b/Sources/Forecast/ForecastView.swift
            --- a/Sources/Forecast/ForecastView.swift
            +++ b/Sources/Forecast/ForecastView.swift
            @@ -14,3 +14,3 @@ struct ForecastView: View {
                 @State private var showList = false
            -    private let refreshInterval: Duration = .seconds(30)
            +    private let refreshInterval: Duration = .minutes(10)
                 let forecast: Forecast
            @@ -20,8 +20,10 @@ struct ForecastView: View {
                 var body: some View {
                     VStack(alignment: .leading) {
                         CurrentConditions(now: forecast.now)
            -            HourlyList(hours: forecast.hours)
            -                .frame(height: 220)
            +            if showList {
            +                HourlyList(hours: forecast.hours)
            +            } else {
            +                HourlyChart(hours: forecast.hours)
            +            }
                     }
                 }
            """
        }
        return """
        diff --git a/Sources/Forecast/HourlyChart.swift b/Sources/Forecast/HourlyChart.swift
        new file mode 100644
        --- /dev/null
        +++ b/Sources/Forecast/HourlyChart.swift
        @@ -0,0 +1,8 @@
        +import Charts
        +import SwiftUI
        +
        +struct HourlyChart: View {
        +    let hours: [Hour]
        +    var body: some View {
        +        Chart(hours) { LineMark(x: .value("Hour", $0.time), y: .value("°C", $0.temperature)) }
        +    }
        +}
        """
    }

    static let approvedReply = "Fixed. `DayBoundary` now uses the calendar's start of day instead of subtracting 24 hours, so dates near midnight land on the right day. `npm test -- dates` passes: 18 tests, 0 failures."
    static let deniedReply = "Understood, I won't run the tests. The fix is in `DayBoundary.swift`; run `npm test -- dates` when you're ready."
    static let cannedReply = "This is the sample workspace, so no agent is running. Pair Capsule with your computer to send this to a real agent."
}
