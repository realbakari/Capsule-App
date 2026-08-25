import { useEffect, useState } from "react";
import { Conversation } from "./features/conversation/Conversation";
import { RuntimesView } from "./features/harness/RuntimesView";
import { ApprovalsView, HistoryView, SkillsView } from "./features/library/LibraryViews";
import { SettingsView } from "./features/settings/SettingsView";
import { Inspector } from "./features/shell/Inspector";
import { Palette } from "./features/shell/Palette";
import { Sidebar } from "./features/shell/Sidebar";
import { Splash } from "./features/shell/Splash";
import { Titlebar } from "./features/shell/Titlebar";
import { WorkspaceProvider, useWorkspace } from "./lib/workspace";

const BOOT_SPLASH_MS = 1100;
const BOOT_FADE_MS = 200;

function Shell() {
  const { view } = useWorkspace();
  return (
    <div className="app">
      <Titlebar />
      <div className={`shell ${view === "chat" ? "" : "no-inspector"}`}>
        <Sidebar />
        {view === "chat" && <Conversation />}
        {view === "runtimes" && <RuntimesView />}
        {view === "skills" && <SkillsView />}
        {view === "history" && <HistoryView />}
        {view === "approvals" && <ApprovalsView />}
        {view === "settings" && <SettingsView />}
        {view === "chat" && <Inspector />}
      </div>
      <Palette />
    </div>
  );
}

export default function App() {
  const [phase, setPhase] = useState<"holding" | "fading" | "done">("holding");

  useEffect(() => {
    const fade = window.setTimeout(() => setPhase("fading"), BOOT_SPLASH_MS);
    const done = window.setTimeout(() => setPhase("done"), BOOT_SPLASH_MS + BOOT_FADE_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, []);

  return (
    <WorkspaceProvider>
      {phase !== "done" && <Splash fading={phase === "fading"} />}
      <Shell />
    </WorkspaceProvider>
  );
}
