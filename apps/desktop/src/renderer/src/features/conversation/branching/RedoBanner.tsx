import { useState } from "react";
import type { RedoPoint } from "@capsule/shared";
import { RedoIcon, XIcon } from "../../shell/icons";
import { redoSummary } from "./branch-labels";

/** After a restore: what happened, and the one way to take it back while it still applies. */
export function RedoBanner({ point, turnNumber, onRedo, onDismiss }: {
  point: RedoPoint;
  turnNumber?: number;
  onRedo: () => Promise<void>;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="redo-banner" role="status">
      <span className="redo-banner-text">
        {redoSummary(point, turnNumber)} <span className="redo-banner-hint">Redo is available until you send another message.</span>
      </span>
      <button type="button" className="chip" disabled={busy} onClick={() => { setBusy(true); void onRedo().finally(() => setBusy(false)); }}>
        <RedoIcon size={13} aria-hidden /> {busy ? "Redoing…" : "Redo"}
      </button>
      <button type="button" className="icon-btn" title="Dismiss" aria-label="Dismiss. Redo stays in the command palette." onClick={onDismiss}>
        <XIcon size={13} />
      </button>
    </div>
  );
}
