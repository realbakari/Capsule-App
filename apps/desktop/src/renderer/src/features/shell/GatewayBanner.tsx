import { useWorkspace } from "../../lib/workspace";

export function GatewayBanner({ inset }: { inset?: boolean }) {
  const { connected, status, api } = useWorkspace();
  if (connected) return null;
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
