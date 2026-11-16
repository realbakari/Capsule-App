import type { ApprovalRequest } from "@capsule/shared";

export const APPROVE_ONCE_UNAVAILABLE = "This agent doesn't allow one-time approval here. Deny it, or change Agent permissions.";

/** Proposed tool data is displayed as text, never interpreted as commands or HTML. */
export function ApprovalDetails({ approval }: { approval: ApprovalRequest }) {
  const details = approval.details;
  if (!details) return null;
  return <>
    {!details.canApproveOnce && <p role="status" className="faint">{APPROVE_ONCE_UNAVAILABLE}</p>}
    {details.preview && <details className="advanced">
      <summary>Proposed operation{details.kind ? ` · ${details.kind}` : ""}</summary>
      <pre className="mono" style={{ maxHeight: "18rem", overflow: "auto", whiteSpace: "pre-wrap" }}>{details.preview}</pre>
      {details.truncated && <p className="faint">Preview shortened. Inspect the complete operation in the agent before approving.</p>}
    </details>}
  </>;
}
