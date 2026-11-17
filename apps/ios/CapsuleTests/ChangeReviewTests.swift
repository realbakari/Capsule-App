import Foundation
import Testing
@testable import Capsule

@Suite("Changes list")
struct ChangesListTests {
    @Test func groupsByFolderUnderTheSharedPrefix() {
        let paths = [
            "apps/desktop/src/features/conversation/Thread.tsx",
            "apps/desktop/src/main.ts",
            "apps/desktop/src/features/conversation/Composer.tsx",
            "apps/desktop/src/features/review/Diff.tsx",
        ]
        let grouping = FolderGrouping(paths) { $0 }
        #expect(grouping.common == "apps/desktop/src")
        #expect(grouping.groups.map(\.folder) == ["", "features/conversation", "features/review"])
        #expect(grouping.groups[1].files == [
            "apps/desktop/src/features/conversation/Composer.tsx",
            "apps/desktop/src/features/conversation/Thread.tsx",
        ])
        #expect(grouping.files.first == "apps/desktop/src/main.ts")
    }

    @Test func sharedPrefixStopsAtWholeFolders() {
        let grouping = FolderGrouping(["src/app/a.ts", "src/apple/b.ts"]) { $0 }
        #expect(grouping.common == "src")
        #expect(grouping.groups.map(\.folder) == ["app", "apple"])
    }

    @Test func oneFolderIsOneUnnamedGroup() {
        let grouping = FolderGrouping(["Sources/Forecast/B.swift", "Sources/Forecast/A.swift"]) { $0 }
        #expect(grouping.common == "Sources/Forecast")
        #expect(grouping.groups.count == 1)
        #expect(grouping.groups[0].folder.isEmpty)
        #expect(grouping.files == ["Sources/Forecast/A.swift", "Sources/Forecast/B.swift"])
    }

    @Test func topLevelFilesShareNothing() {
        let grouping = FolderGrouping(["README.md", "src/a.ts"]) { $0 }
        #expect(grouping.common.isEmpty)
        #expect(grouping.groups.map(\.folder) == ["", "src"])
    }

    @Test(arguments: [("added" as String?, ChangeStatus.added), ("deleted", .deleted), ("modified", .modified), (nil, .modified)])
    func turnStatusReadsAsALetter(_ raw: String?, _ expected: ChangeStatus) {
        #expect(ChangeStatus(turn: raw) == expected)
    }

    @Test(arguments: [("??", ChangeStatus.untracked), ("A ", .added), (" M", .modified), ("R ", .renamed), (" D", .deleted)])
    func gitCodeReadsAsALetter(_ code: String, _ expected: ChangeStatus) {
        #expect(ChangeStatus(git: code) == expected)
    }
}

@Suite("Viewed marks")
struct ViewedMarksTests {
    let file = TurnDiff.File(path: "src/a.ts", added: 3, removed: 1, status: "modified")

    @Test func markingIsPerTurnAndPerVersion() {
        var marks = ViewedMarks()
        marks.set(true, [file], in: "run-1")
        #expect(marks.isViewed(file, in: "run-1"))
        #expect(!marks.isViewed(file, in: "run-2"))
        var edited = file
        edited.added = 4
        #expect(!marks.isViewed(edited, in: "run-1"))
        #expect(marks.unviewedCount([file, edited], in: "run-1") == 1)
        marks.set(false, [file], in: "run-1")
        #expect(!marks.isViewed(file, in: "run-1"))
        #expect(marks == ViewedMarks())
    }

    @Test func keepsOnlyTheNewestTurns() {
        var marks = ViewedMarks()
        let start = Date(timeIntervalSince1970: 1_000)
        for index in 0...ViewedMarks.maxTurns {
            marks.set(true, [file], in: "run-\(index)", now: start.addingTimeInterval(Double(index)))
        }
        #expect(!marks.isViewed(file, in: "run-0"))
        #expect(marks.isViewed(file, in: "run-1"))
        #expect(marks.isViewed(file, in: "run-\(ViewedMarks.maxTurns)"))
    }

    @Test func survivesARelaunch() throws {
        let defaults = try #require(UserDefaults(suiteName: "viewed-marks-test"))
        defaults.removePersistentDomain(forName: "viewed-marks-test")
        var marks = ViewedMarks()
        marks.set(true, [file], in: "run-1")
        marks.save(defaults)
        #expect(ViewedMarks.load(defaults).isViewed(file, in: "run-1"))
    }
}

@Suite("Hunk headers")
struct HunkHeaderTests {
    @Test func readsRangesAndContext() throws {
        let hunk = try #require(UnifiedDiff.Hunk.parse("@@ -26,6 +26,7 @@ import {"))
        #expect(hunk == UnifiedDiff.Hunk(oldStart: 26, oldCount: 6, newStart: 26, newCount: 7, context: "import {"))
        #expect(hunk.lines == "Lines 26–32")
    }

    @Test func omittedCountIsOneLine() throws {
        let hunk = try #require(UnifiedDiff.Hunk.parse("@@ -5 +5 @@"))
        #expect(hunk.context.isEmpty)
        #expect(hunk.lines == "Line 5")
    }

    @Test func removalOnlyNamesTheOldLines() throws {
        let hunk = try #require(UnifiedDiff.Hunk.parse("@@ -10,3 +9,0 @@ func gone()"))
        #expect(hunk.lines == "Lines 10–12")
    }

    @Test func notAHunk() {
        #expect(UnifiedDiff.Hunk.parse("diff --git a/x b/x") == nil)
    }

    @Test func headerLinesBecomeTheFileStatus() throws {
        let diff = UnifiedDiff.parse("""
        diff --git a/old/name.swift b/new/name.swift
        similarity index 90%
        rename from old/name.swift
        rename to new/name.swift
        --- a/old/name.swift
        +++ b/new/name.swift
        @@ -1,1 +1,1 @@
        -let a = 1
        +let a = 2
        diff --git a/new.txt b/new.txt
        new file mode 100644
        --- /dev/null
        +++ b/new.txt
        @@ -0,0 +1 @@
        +hello
        """)
        let renamed = try #require(diff.files.first)
        #expect(renamed.path == "new/name.swift")
        #expect(renamed.status == .renamed)
        #expect(renamed.oldPath == "old/name.swift")
        #expect(!renamed.lines.contains { $0.kind == .meta })
        #expect(diff.files[1].status == .added)
        #expect(diff.files[1].lines.last?.newNumber == 1)
    }
}

@Suite("Skill search")
struct SkillSearchTests {
    let skills = [
        SkillInfo(id: "release-notes", name: "Release notes", description: "Summarise merged pull requests"),
        SkillInfo(id: "review", name: "Review", description: "Read a change for bugs"),
        SkillInfo(id: "pre-review", name: "Pre-review checklist", description: nil),
        SkillInfo(id: "deploy", name: "Deploy", description: "Ship to staging, then review the logs"),
        SkillInfo(id: "code-reviewer", name: "Codereviewer", description: nil),
    ]

    @Test func namePrefixThenWordThenSubstringThenDescription() {
        let names = SkillSearch.rank(skills, query: "rev").map(\.id)
        #expect(names == ["review", "pre-review", "code-reviewer", "deploy"])
    }

    @Test func noQueryPutsRecentFirstThenByName() {
        let names = SkillSearch.rank(skills, query: "", recent: ["review", "missing", "deploy"]).map(\.id)
        #expect(names == ["review", "deploy", "code-reviewer", "pre-review", "release-notes"])
    }

    @Test func recentListIsNewestFirstWithoutRepeats() {
        #expect(RecentSkills.adding("b", to: ["a", "b", "c"]) == ["b", "a", "c"])
        let full = (0..<RecentSkills.limit).map(String.init)
        #expect(RecentSkills.adding("new", to: full).count == RecentSkills.limit)
        #expect(RecentSkills.adding("new", to: full).first == "new")
    }
}

@Suite("File kinds")
struct FileKindTests {
    @Test func kindsFollowNameThenExtension() {
        #expect(FileKind.of("Sources/App.swift").mark == .symbol("swift"))
        #expect(FileKind.of("src/View.tsx").mark == .letters("TS"))
        #expect(FileKind.of("package.json").mark == .symbol("shippingbox"))
        #expect(FileKind.of("config/settings.json").mark == .symbol("curlybraces"))
        #expect(FileKind.of(".gitignore").mark == .symbol("arrow.triangle.branch"))
        #expect(FileKind.of("notes.unknown").mark == .symbol("doc"))
    }

    @Test(arguments: ["thing.test.ts", "ThingTests.swift", "thing_test.go", "test_thing.py", "thing.spec.js"])
    func testFilesAreMarked(_ name: String) {
        #expect(FileKind.isTest(name))
    }

    @Test(arguments: ["latest.ts", "contest.swift", "Test.swift", "attestation.md"])
    func otherFilesAreNotTests(_ name: String) {
        #expect(!FileKind.isTest(name))
    }
}

@Suite("Review comments")
struct ReviewCommentTests {
    let file = UnifiedDiff.parse("""
    diff --git a/Forecast.swift b/Forecast.swift
    --- a/Forecast.swift
    +++ b/Forecast.swift
    @@ -10,4 +10,4 @@
     let a = 1
    -let b = 2
    -let c = 3
    +let b = 4
     let d = 5
    """).files[0]

    @Test func blockMatchesTheComputersFormat() {
        let comments = [
            ReviewComment(path: "b.swift", lines: 4...4, removed: false, text: "Rename this"),
            ReviewComment(path: "a.swift", lines: 12...14, removed: true, text: "Why drop these?\nThey were used."),
        ]
        #expect(ReviewComment.block(comments) == """
        Review comments:
        - a.swift:12–14 (removed line) — Why drop these?
          They were used.
        - b.swift:4 — Rename this
        """)
    }

    @Test func removedOnlySelectionCountsInTheOldFile() throws {
        let comment = try #require(PatchLines.comment(on: file, 2...3, text: " Keep c "))
        #expect(comment.removed)
        #expect(comment.lines == 11...12)
        #expect(comment.text == "Keep c")
        #expect(PatchLines.anchor(of: comment, in: file) == 3)
    }

    @Test func mixedSelectionCountsInTheNewFile() throws {
        let comment = try #require(PatchLines.comment(on: file, 1...5, text: "Tidy"))
        #expect(!comment.removed)
        #expect(comment.lines == 10...12)
        #expect(PatchLines.anchor(of: comment, in: file) == 5)
    }

    @Test func emptyNoteIsNotKept() {
        #expect(PatchLines.comment(on: file, 1...1, text: "  \n") == nil)
    }
}
