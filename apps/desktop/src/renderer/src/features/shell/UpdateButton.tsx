import { useEffect, useRef } from "react";
import type { UpdateCheck } from "@capsule/shared";
import { updateButtonView, updateDownloadedToast, updateNotAppliedToast, updateOutcomeToast, useUpdates, type UpdateButtonView } from "../../lib/updates";
import { useToasts } from "../../lib/toasts";
import { CheckIcon, DownloadIcon, RefreshIcon, RotateClockwiseIcon } from "./icons";

const RING = 2 * Math.PI * 14;

function UpdateGlyph({ view }: { view: UpdateButtonView }) {
  switch (view.icon) {
    case "available": return <><DownloadIcon size={14} /><span className="update-dot" /></>;
    case "downloading": return <>
      <svg className="update-ring" viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="14" />
        <circle cx="16" cy="16" r="14" strokeDasharray={RING} strokeDashoffset={RING * (1 - Math.min(100, Math.max(0, view.percent ?? 0)) / 100)} />
      </svg>
      <DownloadIcon size={14} />
    </>;
    case "ready": return <span className="update-glyph"><RotateClockwiseIcon size={14} /><span className="update-badge"><CheckIcon size={7} strokeWidth={4} /></span></span>;
    default: return <RefreshIcon size={14} />;
  }
}

/**
 * The sidebar footer's one update control. Its glyph carries the state, its
 * tooltip the version and the next step; nothing about updates sits in the
 * footer as text.
 */
export function UpdateButton() {
  const { show } = useToasts();
  const update = useUpdates((outcome) => {
    const toast = updateOutcomeToast(outcome);
    if (toast) show(toast);
  });
  const state = update.status?.state;
  const previous = useRef<UpdateCheck["state"] | undefined>(undefined);
  useEffect(() => {
    if (state === "ready-to-install" && (previous.current === "downloading" || previous.current === "update-available")) {
      show(updateDownloadedToast(update.status));
    }
    previous.current = state;
  }, [state, show, update.status]);
  const notApplied = update.status?.notApplied;
  const retryInstall = useRef(update.retryInstall);
  retryInstall.current = update.retryInstall;
  const toldNotApplied = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!notApplied || !update.status || toldNotApplied.current === notApplied) return;
    toldNotApplied.current = notApplied;
    show(updateNotAppliedToast(update.status, () => retryInstall.current()));
  }, [notApplied, show, update.status]);

  const view = updateButtonView(update.status, update.working);
  const label = view.detail ? `${view.tooltip}: ${view.detail}` : view.tooltip;
  const spinning = view.icon === "checking" || view.icon === "installing";
  const prominent = !["idle", "checking"].includes(view.icon);
  return (
    <button
      type="button"
      className={`icon-btn update-button${prominent ? " has-update" : ""}${spinning ? " is-spinning" : ""}`}
      title={label}
      aria-label={label}
      aria-disabled={view.action ? undefined : true}
      data-update-state={view.icon}
      onClick={view.action ? update.run : undefined}
    >
      <UpdateGlyph view={view} />
    </button>
  );
}
