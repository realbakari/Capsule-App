import type { HarnessLiveStatus, Project, Session } from "@capsule/shared";

export function harnessStatusIdentity(session: Session, project?: Project): string {
  return JSON.stringify([session.id, session.harnessId, session.openclawSessionKey,
    session.workingDirectory ?? project?.workingDirectory, session.harnessState === "closed"]);
}

interface CachedStatus { identity: string; status: HarnessLiveStatus }

/** UI choices belong to the live runtime, not merely to its containing thread. */
export class HarnessStatusCache {
  private readonly values = new Map<string, CachedStatus>();
  private readonly requests = new Map<string, { identity: string; promise: Promise<boolean> }>();

  get(session: Session, project?: Project): HarnessLiveStatus | undefined {
    const value = this.values.get(session.id);
    return value?.identity === harnessStatusIdentity(session, project) ? value.status : undefined;
  }

  load(session: Session, project: Project | undefined, read: () => Promise<HarnessLiveStatus>,
    currentIdentity: () => string | undefined, force = false): Promise<boolean> {
    const identity = harnessStatusIdentity(session, project);
    const pending = this.requests.get(session.id);
    if (!force && pending?.identity === identity) return pending.promise;
    const request = { identity, promise: Promise.resolve(false) };
    request.promise = read().then((status) => {
      if (this.requests.get(session.id) !== request || currentIdentity() !== identity ||
        (status.harnessId && status.harnessId !== session.harnessId) ||
        (status.openclawSessionKey && status.openclawSessionKey !== session.openclawSessionKey)) return false;
      this.values.delete(session.id);
      this.values.set(session.id, { identity, status });
      while (this.values.size > 128) this.values.delete(this.values.keys().next().value!);
      return true;
    }).finally(() => {
      if (this.requests.get(session.id) === request) this.requests.delete(session.id);
    });
    this.requests.set(session.id, request);
    return request.promise;
  }
}
