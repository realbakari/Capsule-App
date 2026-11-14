import { useEffect, useState } from "react";
import { useWorkspace } from "../../lib/workspace";

export function RemoteSessionBanner() {
  const { api } = useWorkspace();
  const [, refresh] = useState(0);
  useEffect(() => { const off = api.on("connection", () => refresh((value) => value + 1)); return () => { off(); }; }, [api]);
  if (api.isDesktop || !["read", "control", "connecting", "share"].includes(api.remoteMode)) return null;
  return <div className="remote-session-banner" role="status">
    <span>{api.remoteError ?? (api.remoteMode === "control" ? "Connected to your Capsule host · Conversation control · New threads are Supervised"
      : api.remoteMode === "read" ? "Connected to your Capsule host · Read only"
      : api.remoteMode === "share" ? "Shared conversation · Read only"
      : "Reconnecting to your Capsule host… Your loaded conversation stays here.")}</span>
    {!api.remoteShare && <button className="ghost" type="button" onClick={() => {
      try { sessionStorage.removeItem("capsule.remote.token"); } catch { /* Storage may be disabled. */ }
      window.location.reload();
    }}>Disconnect</button>}
  </div>;
}
