import { useEffect, useState } from "react";
import type { WorktreeBases } from "@capsule/shared";
import { MenuSelect } from "../shell/MenuSelect";
import { GitBranchIcon } from "../shell/icons";
import { defaultBaseDetail, worktreeBaseOptions } from "../../lib/worktree-base";
import { formatUserError } from "../../lib/errors";
import "./worktree-base.css";

/**
 * Which branch a worktree starts from. In a thread it names a concrete ref;
 * as a project setting, "" means follow the remote default.
 */
export function WorktreeBasePicker({
  projectId,
  value,
  onChange,
  followDefault = false,
  unavailableReason,
}: {
  projectId: string;
  value?: string;
  onChange: (ref: string) => Promise<void> | void;
  followDefault?: boolean;
  unavailableReason?: string;
}) {
  const [bases, setBases] = useState<WorktreeBases>();
  const [error, setError] = useState<string>();
  const [moving, setMoving] = useState<string>();
  useEffect(() => {
    let current = true;
    setBases(undefined);
    setError(undefined);
    window.capsule.listWorktreeBases(projectId)
      .then((loaded) => { if (current) setBases(loaded); })
      .catch((failure: unknown) => { if (current) setError(formatUserError(failure)); });
    return () => { current = false; };
  }, [projectId]);

  const options = bases ? worktreeBaseOptions(bases, value || undefined, followDefault) : [];
  const selected = followDefault ? value ?? "" : value ?? bases?.defaultRef ?? "";
  return (
    <MenuSelect
      ariaLabel="Base branch"
      icon={<GitBranchIcon size={12} />}
      value={moving ?? selected}
      placeholder={error ? "Branches unavailable" : moving ? `${moving}…` : bases ? undefined : "Loading branches…"}
      options={options}
      unavailableReason={unavailableReason ?? (moving ? `Moving the worktree to ${moving}…` : error ?? (bases ? undefined : "Loading branches…"))}
      search={{ label: "Filter branches", placeholder: "Search branches", empty: "No branch matches." }}
      footer={bases ? defaultBaseDetail(bases) : undefined}
      onChange={(ref) => {
        if (ref === selected) return;
        setMoving(ref);
        void Promise.resolve(onChange(ref)).finally(() => setMoving(undefined));
      }}
    />
  );
}
