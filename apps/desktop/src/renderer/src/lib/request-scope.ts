/** Reject late answers, including A → B → A and a read overtaken by a write. */
export class RequestScope {
  private key?: string;
  private token = {};
  private versions = new Map<string, number>();

  select(key: string): object {
    if (this.key !== key) { this.key = key; this.token = {}; this.versions.clear(); }
    return this.token;
  }

  capture(resource: string): () => boolean {
    const token = this.token;
    const version = (this.versions.get(resource) ?? 0) + 1;
    this.versions.set(resource, version);
    return () => this.token === token && this.versions.get(resource) === version;
  }

  isCurrent(token: object): boolean { return this.token === token; }
}
