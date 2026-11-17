import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { APPROVAL_PRESETS, approvalOptionDetail, approvalPreset, type ApprovalRoute, type HarnessPermissionProfile } from "@capsule/shared";
import { ChevronUpIcon, LockIcon, ShieldCheckIcon, ShieldIcon, ShieldOffIcon } from "../shell/icons";
import { useAnchoredPopover } from "../../lib/anchored-popover";

export const APPROVAL_ICONS: Record<HarnessPermissionProfile, ComponentType<{ size?: number }>> = {
  strict: LockIcon,
  default: ShieldCheckIcon,
  "approve-all": ShieldOffIcon,
};

export type ApprovalChoice = {
  current: HarnessPermissionProfile; route: ApprovalRoute; harnessId?: string;
  unavailableReason?: string; onPick: (id: HarnessPermissionProfile) => void;
};

/**
 * The approval mode, named with its icon, opening one small popover: the
 * presets as an icon toggle with the shown one described below, then the
 * agent's own permission settings when it reports them.
 */
export function PermissionsMenu(props: { approval?: ApprovalChoice; agentSettings?: ReactNode; className?: string; chevron?: boolean }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<HarnessPermissionProfile>();
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const position = useAnchoredPopover(open, anchor, panel, "end", 288);
  const current = props.approval ? approvalPreset(props.approval.current) : undefined;
  const CurrentIcon = current ? APPROVAL_ICONS[current.id] : ShieldIcon;
  const shown = props.approval ? approvalPreset(preview ?? props.approval.current) : undefined;
  function close() { setOpen(false); setPreview(undefined); trigger.current?.focus(); }
  /* Focus waits for the popover to be placed: a hidden element cannot take it. */
  useEffect(() => {
    if (open && position.visibility === "visible" && !panel.current?.contains(document.activeElement)) {
      (panel.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ?? panel.current?.querySelector<HTMLElement>('button[tabindex="0"]'))?.focus();
    }
  }, [open, position.visibility]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) { setOpen(false); setPreview(undefined); }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  if (!props.approval && !props.agentSettings) return null;
  const label = current?.label ?? "Permissions";
  return <div className={`permissions-menu${props.className ? ` ${props.className}` : ""}`} ref={anchor}>
    <button ref={trigger} type="button" className="permissions-trigger" data-setting="Permissions" aria-label={`Permissions: ${label}`}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <CurrentIcon size={14} /><span>{label}</span>{props.chevron ? <ChevronUpIcon size={12} /> : null}
    </button>
    {open && createPortal(<div ref={panel} className="permissions-pop" style={position} role="dialog" aria-label="Permissions"
      onKeyDown={(event) => {
        /* Its own keys: the picker it may sit in never sees them. */
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); close(); return; }
        if (event.key === "Tab") {
          const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button[tabindex="0"], button:not([tabindex])') ?? []);
          const index = controls.indexOf(document.activeElement as HTMLElement);
          event.preventDefault();
          controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
        }
      }}>
      <p className="permissions-heading">Permissions</p>
      {props.approval && shown && <>
        <div role="radiogroup" aria-label="Approvals" className="permissions-segments" onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
          const next = items[items.indexOf(document.activeElement as HTMLButtonElement) + (event.key === "ArrowRight" ? 1 : -1)];
          if (!next) return;
          event.preventDefault();
          next.focus();
        }}>
          {APPROVAL_PRESETS.map((preset) => {
            const Icon = APPROVAL_ICONS[preset.id];
            const checked = preset.id === props.approval!.current;
            return <button type="button" role="radio" key={preset.id} aria-checked={checked} aria-label={preset.label} tabIndex={checked ? 0 : -1}
              aria-disabled={props.approval!.unavailableReason ? true : undefined} title={props.approval!.unavailableReason ? `${preset.label}. ${props.approval!.unavailableReason}` : preset.label}
              aria-description={approvalOptionDetail(preset.id, props.approval!)}
              onPointerEnter={() => setPreview(preset.id)} onPointerLeave={() => setPreview(undefined)}
              onFocus={() => setPreview(preset.id)} onBlur={() => setPreview(undefined)}
              onClick={() => {
                if (props.approval!.unavailableReason) return;
                if (!checked) props.approval!.onPick(preset.id);
                close();
              }}><Icon size={14} /></button>;
          })}
        </div>
        {/* Every mode's description is laid out in one cell, so previewing one never changes the popover's height. */}
        <div className="permissions-shown" aria-hidden="true">
          {APPROVAL_PRESETS.map((preset) => <div key={preset.id} data-shown={preset.id === shown.id || undefined}>
            <span className={preset.id === props.approval!.current ? "is-current" : undefined}>{preset.label}</span>
            <small>{props.approval!.unavailableReason && preset.id === props.approval!.current ? props.approval!.unavailableReason : approvalOptionDetail(preset.id, props.approval!)}</small>
          </div>)}
        </div>
      </>}
      {props.agentSettings}
    </div>, document.body)}
  </div>;
}
