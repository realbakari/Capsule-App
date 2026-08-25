import { useWorkspace } from "../../lib/workspace";

export function GatewayBanner({ inset }: { inset?: boolean }) {
  const { connected, status, harnesses, api } = useWorkspace();
  if (connected) return null;
  const detected = harnesses.find((item) => item.binaryPath);
  return (
    <div className={`banner ${inset ? "inline" : ""}`}>
      <div>
        <b>OpenClaw Gateway is offline</b>
        <p>
          {detected
            ? `Picked up ${detected.name} at ${detected.binaryPath}. Start the Gateway to spawn it — Capsule does not install another copy.`
            : `Looking for ${status?.gatewayHost ?? "127.0.0.1"}:${status?.gatewayPort ?? 18789}. Claude Code and Codex are detected on this Mac or the Gateway host; they are not installed inside Capsule.`}
        </p>
      </div>
      <button className="send" onClick={() => void api.connectGateway()}>
        Connect
      </button>
    </div>
  );
}
