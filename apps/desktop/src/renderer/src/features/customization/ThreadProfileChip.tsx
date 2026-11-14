import type { CSSProperties } from "react";
import { useWorkspace } from "../../lib/workspace";
import "./profiles.css";

/** Which profile started the open thread. A profile file removed since still shows its id. */
export function ThreadProfileChip() {
  const { session, config } = useWorkspace();
  if (!session?.profileId) return null;
  const profile = config?.profiles.find((item) => item.id === session.profileId);
  const name = profile?.name ?? session.profileId;
  return (
    <span className="profile-chip" title={profile ? `Started from the ${name} profile` : `Started from the ${name} profile, which is no longer in your profiles`}>
      <span className="profile-dot" style={profile?.color ? { "--profile-color": profile.color } as CSSProperties : undefined} aria-hidden="true" />
      {name}
    </span>
  );
}
