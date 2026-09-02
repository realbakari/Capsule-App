import { useCallback, useEffect, useRef, useState } from "react";
import type { WebviewTag } from "electron";
import type { LocalServer } from "@capsule/shared";
import { ChevronRightIcon, GlobeIcon, RefreshIcon } from "./icons";

const BROWSER_RECENTS_KEY = "capsule.browserRecents";
const MAX_BROWSER_RECENTS = 8;

export interface BrowserRecent {
  url: string;
  title: string;
  lastUsedAt: string;
}

export function parseBrowserRecents(value: string | null): BrowserRecent[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is BrowserRecent =>
          Boolean(
            item &&
            typeof item === "object" &&
            typeof (item as BrowserRecent).url === "string" &&
            typeof (item as BrowserRecent).title === "string" &&
            typeof (item as BrowserRecent).lastUsedAt === "string" &&
            normalizedBrowserUrl((item as BrowserRecent).url) &&
            Number.isFinite(new Date((item as BrowserRecent).lastUsedAt).getTime()),
          ),
      )
      .slice(0, MAX_BROWSER_RECENTS);
  } catch {
    return [];
  }
}

export function mergeBrowserRecent(
  recents: readonly BrowserRecent[],
  next: BrowserRecent,
): BrowserRecent[] {
  return [next, ...recents.filter((item) => item.url !== next.url)].slice(0, MAX_BROWSER_RECENTS);
}

function recentAge(value: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function normalizedBrowserUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(trimmed) && !/^https?:/i.test(trimmed)) return "";
  if (/\s/.test(trimmed)) return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export function EmbeddedBrowser({
  address,
  onAddressChange,
  localServers,
  serversLoading,
  onOpenExternal,
}: {
  address: string;
  onAddressChange: (value: string) => void;
  localServers: LocalServer[];
  serversLoading: boolean;
  onOpenExternal: (url: string) => void;
}) {
  const initialUrl = address !== "http://localhost:3000" ? normalizedBrowserUrl(address) : "";
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [error, setError] = useState<string>();
  const [recents, setRecents] = useState<BrowserRecent[]>(() => {
    try {
      return parseBrowserRecents(localStorage.getItem(BROWSER_RECENTS_KEY));
    } catch {
      return [];
    }
  });
  const webviewRef = useRef<WebviewTag>(null);
  const publishedAddress = useRef(address);

  const publishAddress = useCallback((value: string) => {
    publishedAddress.current = value;
    onAddressChange(value);
  }, [onAddressChange]);

  /*
   * The address can come from outside the browser (a Markdown link, a pull
   * request, or a local-server card). Input edits are marked through
   * `publishedAddress`, so this effect navigates only genuine external opens
   * rather than trying to load every character typed into the address bar.
   */
  useEffect(() => {
    if (address === publishedAddress.current) return;
    publishedAddress.current = address;
    const next = normalizedBrowserUrl(address);
    if (!next || next === currentUrl) return;
    setError(undefined);
    setCurrentUrl(next);
    if (webviewRef.current) void webviewRef.current.loadURL(next);
  }, [address, currentUrl]);

  const rememberCurrentPage = () => {
    const view = webviewRef.current;
    if (!view) return;
    const url = view.getURL();
    if (!normalizedBrowserUrl(url)) return;
    const entry: BrowserRecent = {
      url,
      title: view.getTitle().trim() || new URL(url).hostname,
      lastUsedAt: new Date().toISOString(),
    };
    setRecents((current) => {
      const next = mergeBrowserRecent(current, entry);
      try {
        localStorage.setItem(BROWSER_RECENTS_KEY, JSON.stringify(next));
      } catch {
        // Browser history is a convenience; private/disabled storage should not block navigation.
      }
      return next;
    });
  };

  const syncNavigation = () => {
    const view = webviewRef.current;
    if (!view) return;
    setCanGoBack(view.canGoBack());
    setCanGoForward(view.canGoForward());
  };

  useEffect(() => {
    const view = webviewRef.current;
    if (!view) return undefined;
    const started = () => {
      setLoading(true);
      setError(undefined);
    };
    const stopped = () => {
      setLoading(false);
      syncNavigation();
      rememberCurrentPage();
    };
    const navigated = (event: Event) => {
      const next = (event as Event & { url?: string }).url;
      if (next) publishAddress(next);
      syncNavigation();
    };
    const failed = (event: Event) => {
      const detail = event as Event & { errorCode?: number; errorDescription?: string };
      if (detail.errorCode === -3) return;
      setLoading(false);
      setError(detail.errorDescription || "This page could not be loaded.");
    };
    view.addEventListener("did-start-loading", started);
    view.addEventListener("did-stop-loading", stopped);
    view.addEventListener("did-navigate", navigated);
    view.addEventListener("did-navigate-in-page", navigated);
    view.addEventListener("page-title-updated", rememberCurrentPage);
    view.addEventListener("did-fail-load", failed);
    return () => {
      view.removeEventListener("did-start-loading", started);
      view.removeEventListener("did-stop-loading", stopped);
      view.removeEventListener("did-navigate", navigated);
      view.removeEventListener("did-navigate-in-page", navigated);
      view.removeEventListener("page-title-updated", rememberCurrentPage);
      view.removeEventListener("did-fail-load", failed);
    };
  }, [currentUrl, publishAddress]);

  const navigate = (value: string) => {
    const next = normalizedBrowserUrl(value);
    if (!next) {
      setError("Enter a valid HTTP or HTTPS address.");
      return;
    }
    setError(undefined);
    publishAddress(next);
    if (webviewRef.current) void webviewRef.current.loadURL(next);
    else setCurrentUrl(next);
  };

  return (
    <div className="codex-browser-pane">
      <form
        className="codex-browser-nav"
        onSubmit={(event) => {
          event.preventDefault();
          navigate(address);
        }}
      >
        <button
          className="icon-btn browser-back"
          type="button"
          aria-label="Back"
          title="Back"
          disabled={!canGoBack}
          onClick={() => webviewRef.current?.goBack()}
        >
          <ChevronRightIcon size={14} />
        </button>
        <button
          className="icon-btn"
          type="button"
          aria-label="Forward"
          title="Forward"
          disabled={!canGoForward}
          onClick={() => webviewRef.current?.goForward()}
        >
          <ChevronRightIcon size={14} />
        </button>
        <button
          className="icon-btn"
          type="button"
          aria-label="Reload"
          title="Reload"
          disabled={!currentUrl}
          onClick={() => webviewRef.current?.reload()}
        >
          <RefreshIcon size={13} />
        </button>
        <input
          type="text"
          className="codex-browser-input"
          value={address}
          onChange={(event) => publishAddress(event.target.value)}
          placeholder="Search or enter URL"
        />
        <button className="chip browser-go" type="submit" disabled={!address.trim()}>
          Go
        </button>
        <button
          className="icon-btn"
          type="button"
          aria-label="Show local servers"
          title="Show local servers"
          onClick={() => {
            setCurrentUrl("");
            setCanGoBack(false);
            setCanGoForward(false);
          }}
        >
          <GlobeIcon size={13} />
        </button>
        <button
          className="ghost browser-external"
          type="button"
          disabled={!currentUrl}
          onClick={() => onOpenExternal(currentUrl)}
        >
          External
        </button>
      </form>

      {error ? <div className="browser-error">{error}</div> : null}
      {currentUrl ? (
        <div className="embedded-browser-frame">
          {loading ? <div className="browser-loading"><span className="dot warn live" /> Loading</div> : null}
          <webview
            ref={webviewRef}
            className="embedded-browser-webview"
            src={currentUrl}
            partition="persist:capsule-browser"
            webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
          />
        </div>
      ) : (
        <div className="codex-browser-links local-server-list">
          {recents.length > 0 ? (
            <section className="browser-home-section">
              <h4>Recently used</h4>
              <div className="local-server-grid recent-server-grid">
                {recents.map((recent) => (
                  <button
                    type="button"
                    className="local-server-card"
                    key={recent.url}
                    onClick={() => navigate(recent.url)}
                  >
                    <span className="local-server-icon" aria-hidden>
                      <span />
                      <span />
                      <span />
                    </span>
                    <span className="local-server-copy">
                      <b>{recent.title}</b>
                      <small>
                        {new URL(recent.url).host} · {recentAge(recent.lastUsedAt)}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          <section className="browser-home-section">
            <div className="row">
              <div>
                <h4>Local servers</h4>
                <p className="faint">Select a live app to open it in this browser tab.</p>
              </div>
              <span className={serversLoading ? "dot warn live" : "dot on"} />
            </div>
            {localServers.length === 0 && !serversLoading ? (
              <p className="faint">No local web servers are responding.</p>
            ) : null}
            <div className="local-server-grid">
              {localServers.map((server) => (
                <button
                  type="button"
                  className="local-server-card"
                  key={`${server.protocol}:${server.port}`}
                  onClick={() => navigate(server.url)}
                >
                  <span className="local-server-icon" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </span>
                  <span className="local-server-copy">
                    <b>{server.title || server.command || `Port ${server.port}`}</b>
                    <small>localhost:{server.port}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
