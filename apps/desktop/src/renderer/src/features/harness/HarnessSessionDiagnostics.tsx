import type { HarnessLiveStatus } from "@capsule/shared";

/** Control output belongs to this session's diagnostics, never the chat. */
export function HarnessSessionDiagnostics({ status }: { status?: HarnessLiveStatus }) {
  if (!status?.statusText?.trim()) return null;
  return (
    <details className="harness-session-diagnostics" key={status.session.id}>
      <summary>Session diagnostics</summary>
      <pre>{status.statusText}</pre>
    </details>
  );
}
