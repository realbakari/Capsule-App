import { useCallback, useRef } from "react";
import { useModalFocus } from "../../lib/modal-focus";
import { useWorkspace } from "../../lib/workspace";

export function ConfirmDialog() {
  const { confirm, setConfirm } = useWorkspace();
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useCallback(() => setConfirm(undefined), [setConfirm]);
  /* A destructive confirm starts on Cancel, so Return does not delete. */
  useModalFocus(dialog, Boolean(confirm), cancel, confirm?.danger ? "[data-cancel]" : "[data-confirm]");
  if (!confirm) return null;
  return (
    <div className="palette-backdrop center" onClick={cancel}>
      <div className="dialog" ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-detail" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <h3 id="confirm-title">{confirm.title}</h3>
        <p id="confirm-detail">{confirm.detail}</p>
        <div className="actions">
          <button className="ghost" data-cancel onClick={cancel}>
            Cancel
          </button>
          {confirm.secondary && (
            <button className="chip" onClick={() => confirm.secondary?.onConfirm()}>
              {confirm.secondary.label}
            </button>
          )}
          <button className={confirm.danger ? "danger" : "send"} data-confirm onClick={() => confirm.onConfirm()}>
            {confirm.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
