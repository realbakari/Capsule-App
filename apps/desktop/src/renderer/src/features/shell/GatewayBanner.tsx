import { useWorkspace } from "../../lib/workspace";
import { useState } from "react";

export function GatewayBanner({ inset }: { inset?: boolean }) {
  const { connected, ready, status, api } = useWorkspace();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  // Nothing has been asked yet on the first frames after launch, and "offline"
  // is an answer, not the absence of one.
  if (connected || !ready) return null;
  return (
    <div className={`banner compact gateway-recovery ${inset ? "inline" : ""}`} role="status">
      <span title={status?.gatewayHost ? `${status.gatewayHost}:${status.gatewayPort}` : undefined}>
        Gateway {status?.state === "connecting" ? "connecting…" : "offline"}
        {error && <span className="gateway-recovery-error">{error}</span>}
      </span>
      <button type="button" className="chip" disabled={pending || status?.state === "connecting"} onClick={async () => {
        setPending(true); setError(undefined);
        try { await api.connectGateway(); }
        catch (error) { setError(error instanceof Error ? error.message : String(error)); }
        finally { setPending(false); }
      }}>
        {pending || status?.state === "connecting" ? "Connecting…" : error ? "Retry connection" : "Connect"}
      </button>
    </div>
  );
}
