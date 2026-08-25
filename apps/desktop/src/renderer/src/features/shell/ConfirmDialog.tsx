import { useWorkspace } from "../../lib/workspace";

export function ConfirmDialog() {
  const { confirm, setConfirm } = useWorkspace();
  if (!confirm) return null;
  return (
    <div className="palette-backdrop" onClick={() => setConfirm(undefined)}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <h3>{confirm.title}</h3>
        <p>{confirm.detail}</p>
        <div className="actions">
          <button className="ghost" onClick={() => setConfirm(undefined)}>
            Cancel
          </button>
          <button className={confirm.danger ? "danger" : "send"} onClick={() => confirm.onConfirm()}>
            {confirm.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
