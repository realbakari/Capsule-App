import { useWorkspace } from "../../lib/workspace";

export function Titlebar() {
  const { connected, status, setView } = useWorkspace();
  const label =
    status?.state === "connected"
      ? status.kind === "mock"
        ? "Local mock"
        : "Connected"
      : (status?.state ?? "Disconnected");
  return (
    <header className="titlebar">
      <div className="brand">
        <img className="mark" src="./icon.png" alt="" width={20} height={20} />
        Capsule
      </div>
      <button className="status-pill" onClick={() => setView("settings")}>
        <span className={`dot ${connected ? "on" : status?.state === "connecting" ? "warn" : "off"}`} />
        OpenClaw
        <span>{label}</span>
      </button>
    </header>
  );
}
