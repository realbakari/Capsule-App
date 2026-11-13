import { useEffect, useRef, useState } from "react";
import type { AcpConfigOption } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { MenuSelect } from "../shell/MenuSelect";

/* Agents name options in lowercase ("high"); menus use sentence case. Word by word would turn "iOS" into "IOS". */
function sentenceCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function AgentControl({ sessionId, option, label, disabled = false }: {
  sessionId: string; option: AcpConfigOption; label: string; disabled?: boolean;
}) {
  const { api, refreshHarnessStatus, setNotice } = useWorkspace();
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const scope = useRef<object>({});
  useEffect(() => {
    scope.current = {}; saving.current = false; setPending(false);
    return () => { scope.current = {}; };
  }, [sessionId, option.id]);
  async function change(value: string) {
    if (saving.current || disabled || api.isDesktop !== true) return;
    saving.current = true; setPending(true);
    const current = scope.current;
    try {
      await api.setHarnessConfig(sessionId, option.id, value);
    } catch (error) { if (scope.current === current) setNotice(formatUserError(error)); }
    finally {
      try { await refreshHarnessStatus(sessionId); }
      catch (error) { if (scope.current === current) setNotice(formatUserError(error)); }
      finally { if (scope.current === current) { saving.current = false; setPending(false); } }
    }
  }
  return <MenuSelect ariaLabel={label} value={option.currentValue ?? ""} placeholder={`${label}: agent default`}
    unavailableReason={api.isDesktop !== true ? "Change agent settings on the desktop." : pending ? "Applying setting…" : disabled ? "Wait for the current turn to finish." : undefined}
    options={option.choices.map((choice) => ({ id: choice.value, label: sentenceCase(choice.name), detail: choice.description }))}
    onChange={(value) => void change(value)} />;
}
