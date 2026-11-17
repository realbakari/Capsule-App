import type { ReactNode } from "react";
import { useWorkspace } from "../../lib/workspace";
import { CheckIcon, XIcon } from "../shell/icons";
import { checklistVisible, requestFirstRun, setupChecklist, updateSetupMarks, useSetupMarks } from "./setup-progress";
import "./onboarding.css";

/**
 * What is left of setup after first run was put off, in the sidebar. Each
 * line reopens first run. It goes away once everything is done or it is
 * dismissed; otherwise `fallback` (the plain empty state) shows.
 */
export function SetupChecklist({ fallback = null }: { fallback?: ReactNode }) {
  const { api, harnesses, projects, updateSettings } = useWorkspace();
  const marks = useSetupMarks();
  const items = setupChecklist({ harnesses: harnesses ?? [], projectCount: projects.length });
  if (!checklistVisible({ desktop: api.isDesktop !== false, marks, items })) return <>{fallback}</>;
  const done = items.filter((item) => item.done).length;
  const dismiss = () => {
    updateSetupMarks({ pending: false });
    void updateSettings({ firstRunDone: true }).catch(() => undefined);
  };
  return <section className="setup-checklist" aria-labelledby="setup-checklist-title">
    <div className="setup-checklist-head">
      <button type="button" id="setup-checklist-title" className="setup-checklist-title" onClick={() => requestFirstRun()}>
        Finish setup <span>· {done}/{items.length}</span>
      </button>
      <button type="button" className="setup-checklist-dismiss" aria-label="Dismiss setup checklist" title="Dismiss" onClick={dismiss}>
        <XIcon size={12} />
      </button>
    </div>
    <ul>
      {items.map((item) => <li key={item.id}>
        <button type="button" data-done={item.done || undefined} onClick={() => requestFirstRun()}>
          <span className="setup-checklist-mark" aria-hidden>{item.done ? <CheckIcon size={10} /> : null}</span>
          <span>{item.label}</span>
          <span className="sr-only">{item.done ? "Done" : "Not done"}</span>
        </button>
      </li>)}
    </ul>
  </section>;
}
