import { useState } from "react";
import { suggestAllowRule, type ApprovalRequest } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { APPROVE_ONCE_UNAVAILABLE } from "../harness/ApprovalDetails";
import "./customization.css";

type Reach = "thread" | "local" | "user";

/**
 * "Always allow" on an approval card: for this thread, for this project in
 * your own file, or everywhere in your user file. The rule is shown before
 * anything is saved. Desktop only: a paired device answers once.
 */
export function AlwaysAllow({ approval, projectId, thread }: {
  approval: ApprovalRequest;
  projectId?: string;
  /** Why "this thread" is unavailable, `false` to leave it out, or `true` to offer it. */
  thread: boolean | string;
}) {
  const { api, config, setNotice } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (api.isDesktop !== true) return null;
  const subject = approval.details?.subject;
  const rule = subject ? suggestAllowRule(subject) : undefined;
  const onceMissing = approval.details?.canApproveOnce === false ? APPROVE_ONCE_UNAVAILABLE : undefined;
  const project = config?.project?.projectId === projectId ? config?.project : undefined;
  const projectReason = !rule ? undefined
    : onceMissing
      ?? (!projectId ? "Open this conversation to save a rule for its project."
        : !project ? "Open this project to save a rule for it."
          : !project.trusted ? "Trust this project first. Allow rules in its files wait until the folder is trusted." : undefined);

  function choose(reach: Reach) {
    setBusy(true);
    void (async () => {
      if (reach === "thread") await api.resolveApproval(approval.id, "approved_session");
      else {
        await api.configEditPermissionRule({ op: "add", list: "allow", rule: rule!, scope: reach, ...(reach === "local" ? { projectId } : {}) });
        await api.resolveApproval(approval.id, "approved_once");
      }
    })().catch((error: unknown) => setNotice(formatUserError(error))).finally(() => setBusy(false));
  }

  return (
    <>
      <button type="button" className="chip" aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)}>
        Always allow…
      </button>
      {open && (
        <div className="always-allow" role="group" aria-label="Always allow">
          {rule ? (
            <p className="always-allow-rule">
              Saves the rule <code>{rule}</code>
            </p>
          ) : (
            <p className="always-allow-rule faint">No rule says exactly what this asks, so it can only be allowed for this thread.</p>
          )}
          <div className="always-allow-choices">
            {thread !== false && (
              <button type="button" className="ghost" disabled={busy || typeof thread === "string"} title={typeof thread === "string" ? thread : undefined} onClick={() => choose("thread")}>
                In this thread
              </button>
            )}
            {rule && (
              <>
                <button type="button" className="ghost" disabled={busy || Boolean(projectReason)} title={projectReason} onClick={() => choose("local")}>
                  In this project, only me
                </button>
                <button type="button" className="ghost" disabled={busy || Boolean(onceMissing)} title={onceMissing} onClick={() => choose("user")}>
                  Everywhere
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
