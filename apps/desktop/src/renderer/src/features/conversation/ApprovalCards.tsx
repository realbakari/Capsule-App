import { useState } from "react";
import type { ApprovalRequest, Session } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { harnessDisplayName } from "../../lib/harness";
import { useWorkspace } from "../../lib/workspace";
import { AlwaysAllow } from "../customization/AlwaysAllow";
import { ApprovalDetails, APPROVE_ONCE_UNAVAILABLE } from "../harness/ApprovalDetails";
import { QuestionCard } from "../questions/QuestionCard";

const focusComposer = () => document.querySelector<HTMLTextAreaElement>(".composer-dock textarea.composer-field")?.focus();

/**
 * Every request waiting on the user in one thread, each answerable on its own, oldest at the top.
 * `onReply` runs after Deny and reply; away from the thread it opens the thread first.
 */
export function ApprovalCards({ requests, session, readOnly, onReply = focusComposer }: { requests: readonly ApprovalRequest[]; session?: Session; readOnly: boolean; onReply?: () => void }) {
  if (requests.length === 0) return null;
  return <div className="conversation-requests">
    {requests.map((request) => request.details?.questions?.length
      ? <QuestionCard key={request.id} approval={request} />
      : <ApprovalCard key={request.id} approval={request} session={session} readOnly={readOnly} onReply={onReply} />)}
  </div>;
}

function ApprovalCard({ approval, session, readOnly, onReply }: { approval: ApprovalRequest; session?: Session; readOnly: boolean; onReply: () => void }) {
  const { api, harnesses, setNotice } = useWorkspace();
  /* One decision at a time: a second click while the first is in flight would find the request gone. */
  const [deciding, setDeciding] = useState(false);
  const decide = (decision: "approved_once" | "denied", then?: () => void) => {
    setDeciding(true);
    void api.resolveApproval(approval.id, decision).then(() => then?.(), (error) => setNotice(formatUserError(error))).finally(() => setDeciding(false));
  };
  const reason = approval.reason?.trim();
  return <div className="conversation-approval" role="group" aria-label="Approval required">
    <div className="conversation-approval-ask">
      {harnessDisplayName(harnesses, approval.agentName, approval.agentName)} wants to <b>{approval.action}</b>
    </div>
    {/* The target comes from the agent or a web page: one line, so it cannot draw its own fake card. */}
    <div className="mono conversation-approval-target" title={approval.target}>{approval.target.replace(/\s+/g, " ")}</div>
    {reason && reason.toLowerCase() !== approval.action.trim().toLowerCase() ? <div className="muted">{approval.reason}</div> : null}
    <ApprovalDetails approval={approval} />
    {readOnly ? <p className="faint">This device can only read. Answer on the computer running Capsule.</p> : <div className="actions">
      <button
        className="send"
        disabled={approval.details?.canApproveOnce === false || deciding}
        title={approval.details?.canApproveOnce === false ? APPROVE_ONCE_UNAVAILABLE : undefined}
        onClick={() => decide("approved_once")}
      >
        Approve once
      </button>
      <AlwaysAllow
        approval={approval}
        projectId={session?.projectId}
        thread={session?.openclawSessionKey?.startsWith("direct:") ? "This agent asks again for each request, so it can’t be allowed for the whole conversation." : true}
      />
      <button className="ghost" disabled={deciding} onClick={() => decide("denied")}>
        Deny
      </button>
      {/* Deny, then the message box, to tell the agent what to do instead (as on the phone). */}
      <button
        className="ghost"
        disabled={deciding}
        onClick={() => decide("denied", onReply)}
      >
        Deny and reply
      </button>
    </div>}
  </div>;
}
