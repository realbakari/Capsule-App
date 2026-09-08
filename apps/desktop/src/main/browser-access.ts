import type { BrowserTarget } from "./browser-tools";

/** A grant belongs to one visible thread, never to the globally focused page. */
export class BrowserAccess {
  private owner?: string;
  private allowed = false;

  constructor(private readonly browser: BrowserTarget, private readonly background?: (owner: string, harnessId: string) => BrowserTarget | undefined) {}

  select(owner: string | undefined): void {
    if (owner !== this.owner) this.allowed = false;
    this.owner = owner;
  }

  allow(owner: string, allowed: boolean): void {
    if (owner !== this.owner) throw new Error("Open this thread’s Browser panel first.");
    this.allowed = allowed;
  }

  revoke(owner: string): void { if (owner === this.owner) this.allowed = false; }

  target(owner: string, harnessId = ""): BrowserTarget {
    const background = () => this.background?.(owner, harnessId);
    const check = () => {
      const page = background();
      if (page) { page.check?.(); return; }
      if (owner !== this.owner || !this.allowed) {
        throw new Error("Browser access is off for this thread. Open its Browser panel and enable Allow agent control. Switching threads or closing the panel ends access.");
      }
    };
    return {
      check,
      contents: () => { check(); return (background() ?? this.browser).contents(); },
      open: async (url) => {
        check();
        const page = await this.browser.open?.(url, owner);
        check();
        return page;
      },
    };
  }
}
