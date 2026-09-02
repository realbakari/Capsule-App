import { useWorkspace } from "../../lib/workspace";

export function GatewayBanner({ inset }: { inset?: boolean }) {
  const { connected, ready, status, api } = useWorkspace();
  // Nothing has been asked yet on the first frames after launch, and "offline"
  // is an answer, not the absence of one.
  if (connected || !ready) return null;
  return (
    <div className={`banner compact ${inset ? "inline" : ""}`}>
      <span>
        Gateway {status?.state === "connecting" ? "connecting…" : "offline"}
        {status?.gatewayHost ? ` · ${status.gatewayHost}:${status.gatewayPort}` : ""}
      </span>
      <button className="chip" onClick={() => void api.connectGateway()}>
        Connect
      </button>
    </div>
  );
}
