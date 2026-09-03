import type { WebviewTag } from "electron";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalServer } from "@capsule/shared";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CameraIcon,
  CheckIcon,
  ExternalLinkIcon,
  GlobeIcon,
  MinusIcon,
  MoreVerticalIcon,
  MousePointerClickIcon,
  PictureInPictureIcon,
  PlusIcon,
  RefreshIcon,
} from "./icons";

export interface BrowserRecent {
  url: string;
  title: string;
  lastUsedAt: string;
}

const BROWSER_RECENTS_KEY = "capsule.browser.recents";
const MAX_RECENTS = 6;

const ELEMENT_PICKER_SCRIPT = `
(() => {
  if (window.__capsulePickerActive) {
    if (window.__capsulePickerCleanup) window.__capsulePickerCleanup();
    return Promise.resolve(null);
  }
  window.__capsulePickerActive = true;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = '__capsule_picker_overlay';
    overlay.style.position = 'fixed';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2147483647';
    overlay.style.border = '2px solid #3b82f6';
    overlay.style.background = 'rgba(59, 130, 246, 0.18)';
    overlay.style.borderRadius = '3px';
    overlay.style.transition = 'all 40ms ease';
    overlay.style.display = 'none';

    const badge = document.createElement('div');
    badge.style.position = 'absolute';
    badge.style.bottom = '100%';
    badge.style.left = '0';
    badge.style.marginBottom = '4px';
    badge.style.padding = '2px 6px';
    badge.style.background = '#18181b';
    badge.style.border = '1px solid rgba(255,255,255,0.15)';
    badge.style.color = '#f4f4f5';
    badge.style.fontFamily = 'monospace';
    badge.style.fontSize = '11px';
    badge.style.fontWeight = '500';
    badge.style.borderRadius = '4px';
    badge.style.whiteSpace = 'nowrap';
    badge.style.pointerEvents = 'none';
    badge.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
    overlay.appendChild(badge);
    document.documentElement.appendChild(overlay);

    let currentTarget = null;

    function onMouseMove(e) {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (!target || target === overlay || overlay.contains(target)) return;
      currentTarget = target;
      const rect = target.getBoundingClientRect();
      overlay.style.display = 'block';
      overlay.style.top = rect.top + 'px';
      overlay.style.left = rect.left + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';

      let label = target.tagName.toLowerCase();
      if (target.id) label += '#' + target.id;
      else if (target.className && typeof target.className === 'string') {
        const cls = target.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
        if (cls) label += '.' + cls;
      }
      badge.textContent = label + ' (' + Math.round(rect.width) + ' × ' + Math.round(rect.height) + ')';
    }

    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      if (currentTarget) {
        let tag = currentTarget.tagName.toLowerCase();
        let id = currentTarget.id ? '#' + currentTarget.id : '';
        let cls = currentTarget.className && typeof currentTarget.className === 'string'
          ? '.' + currentTarget.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.')
          : '';
        const selector = tag + id + cls;
        cleanup();
        resolve({ selector, tag });
        return;
      }
      cleanup();
      resolve(null);
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        cleanup();
        resolve(null);
      }
    }

    function cleanup() {
      window.__capsulePickerActive = false;
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      delete window.__capsulePickerCleanup;
    }

    window.__capsulePickerCleanup = () => {
      cleanup();
      resolve(null);
    };

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  });
})()
`;

export function parseBrowserRecents(raw: string | null): BrowserRecent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is BrowserRecent =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof entry.url === "string" &&
        typeof entry.title === "string" &&
        typeof entry.lastUsedAt === "string",
    );
  } catch {
    return [];
  }
}

export function mergeBrowserRecent(existing: BrowserRecent[], next: BrowserRecent): BrowserRecent[] {
  return [next, ...existing.filter((entry) => entry.url !== next.url)].slice(0, MAX_RECENTS);
}

function recentAge(isoDate: string): string {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(isoDate).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function normalizedBrowserUrl(raw: string): string {
  const trimmed = raw.trim();
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
  const [pickActive, setPickActive] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [zoomFactor, setZoomFactor] = useState(1.0);
  const [toast, setToast] = useState<string | null>(null);
  const [recents, setRecents] = useState<BrowserRecent[]>(() => {
    try {
      return parseBrowserRecents(localStorage.getItem(BROWSER_RECENTS_KEY));
    } catch {
      return [];
    }
  });

  const webviewRef = useRef<WebviewTag>(null);
  const publishedAddress = useRef(address);
  const moreMenuAnchorRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<number | undefined>(undefined);

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 2400);
  }, []);

  const publishAddress = useCallback((value: string) => {
    publishedAddress.current = value;
    onAddressChange(value);
  }, [onAddressChange]);

  useEffect(() => {
    if (!moreMenuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!moreMenuAnchorRef.current?.contains(event.target as Node)) {
        setMoreMenuOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMoreMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreMenuOpen]);

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
      } catch {}
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

  const handlePickElement = async () => {
    const view = webviewRef.current;
    if (!view || !currentUrl) return;

    if (pickActive) {
      setPickActive(false);
      try {
        await view.executeJavaScript("if (window.__capsulePickerCleanup) window.__capsulePickerCleanup();");
      } catch {
        // ignore
      }
      return;
    }

    setPickActive(true);
    try {
      const result = (await view.executeJavaScript(ELEMENT_PICKER_SCRIPT)) as { selector?: string; tag?: string } | null;
      setPickActive(false);
      if (result?.selector) {
        await navigator.clipboard.writeText(result.selector);
        showToast(`Copied selector: ${result.selector}`);
      }
    } catch {
      setPickActive(false);
    }
  };

  const handleCaptureScreenshot = async () => {
    const view = webviewRef.current;
    if (!view || !currentUrl) return;

    try {
      const image = await view.capturePage();
      const dataUrl = image.toDataURL();
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
      showToast("Screenshot copied to clipboard");
    } catch {
      try {
        const image = await view.capturePage();
        await navigator.clipboard.writeText(image.toDataURL());
        showToast("Screenshot copied to clipboard");
      } catch {
        showToast("Unable to capture screenshot");
      }
    }
  };

  const handleZoomIn = () => {
    const next = Math.min(3.0, Math.round((zoomFactor + 0.1) * 10) / 10);
    setZoomFactor(next);
    webviewRef.current?.setZoomFactor(next);
  };

  const handleZoomOut = () => {
    const next = Math.max(0.5, Math.round((zoomFactor - 0.1) * 10) / 10);
    setZoomFactor(next);
    webviewRef.current?.setZoomFactor(next);
  };

  const handleResetZoom = () => {
    setZoomFactor(1.0);
    webviewRef.current?.setZoomFactor(1.0);
  };

  const handleClearCache = async () => {
    const view = webviewRef.current;
    if (!view) return;
    try {
      await view.executeJavaScript(`
        try {
          localStorage.clear();
          sessionStorage.clear();
          if ('caches' in window) {
            caches.keys().then(keys => keys.forEach(key => caches.delete(key))).catch(() => {});
          }
        } catch {}
      `);
      showToast("Cache cleared");
    } catch {
      showToast("Unable to clear cache");
    }
    setMoreMenuOpen(false);
  };

  const handleClearCookies = async () => {
    const view = webviewRef.current;
    if (!view) return;
    try {
      await view.executeJavaScript(`
        try {
          document.cookie.split(";").forEach((c) => {
            document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
          });
          localStorage.clear();
          sessionStorage.clear();
        } catch {}
      `);
      showToast("Cookies and storage cleared");
    } catch {
      showToast("Unable to clear cookies");
    }
    setMoreMenuOpen(false);
  };

  return (
    <div className="codex-browser-pane">
      <div className="codex-browser-nav preview-chrome-row">
        <div className="preview-nav-cluster">
          <button
            className="preview-chrome-btn"
            type="button"
            aria-label="Back"
            title="Back"
            disabled={!canGoBack}
            onClick={() => webviewRef.current?.goBack()}
          >
            <ArrowLeftIcon size={14} />
          </button>
          <button
            className="preview-chrome-btn"
            type="button"
            aria-label="Forward"
            title="Forward"
            disabled={!canGoForward}
            onClick={() => webviewRef.current?.goForward()}
          >
            <ArrowRightIcon size={14} />
          </button>
          <button
            className="preview-chrome-btn"
            type="button"
            aria-label={loading ? "Stop loading" : "Reload"}
            title={loading ? "Stop loading" : "Reload"}
            disabled={!currentUrl}
            onClick={() => (loading ? webviewRef.current?.stop() : webviewRef.current?.reload())}
          >
            <RefreshIcon size={13} className={loading ? "preview-spin-icon" : ""} />
          </button>
        </div>

        <form
          className="preview-address-group"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(address);
          }}
        >
          <input
            type="text"
            className="preview-address-input"
            value={address}
            onChange={(event) => publishAddress(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                publishAddress(currentUrl);
                (event.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Search or enter URL"
            spellCheck={false}
          />
          {currentUrl ? (
            <button
              className="preview-address-inline-btn"
              type="button"
              title="Open in system browser"
              aria-label="Open in system browser"
              onClick={() => onOpenExternal(currentUrl)}
            >
              <ExternalLinkIcon size={12} />
            </button>
          ) : null}
        </form>

        <div className="preview-actions-cluster">
          <button
            className={`preview-chrome-btn ${pickActive ? "active" : ""}`}
            type="button"
            aria-label="Inspect element"
            title={pickActive ? "Cancel inspection (Esc)" : "Inspect element"}
            disabled={!currentUrl}
            onClick={handlePickElement}
          >
            <MousePointerClickIcon size={14} />
          </button>

          <button
            className="preview-chrome-btn"
            type="button"
            aria-label="Capture screenshot"
            title="Capture screenshot"
            disabled={!currentUrl}
            onClick={() => void handleCaptureScreenshot()}
          >
            <CameraIcon size={14} />
          </button>

          <button
            className="preview-chrome-btn"
            type="button"
            aria-label="Open in system browser"
            title="Open in system browser"
            disabled={!currentUrl}
            onClick={() => onOpenExternal(currentUrl)}
          >
            <PictureInPictureIcon size={14} />
          </button>

          <div className="preview-menu-anchor" ref={moreMenuAnchorRef}>
            <button
              className={`preview-chrome-btn ${moreMenuOpen ? "active" : ""}`}
              type="button"
              aria-label="More options"
              title="More options"
              onClick={() => setMoreMenuOpen((prev) => !prev)}
            >
              <MoreVerticalIcon size={14} />
            </button>

            {moreMenuOpen && (
              <div className="preview-more-menu" role="menu">
                <button
                  type="button"
                  className="preview-menu-item"
                  disabled={!currentUrl}
                  onClick={() => {
                    webviewRef.current?.reloadIgnoringCache();
                    setMoreMenuOpen(false);
                  }}
                >
                  Hard reload
                </button>
                <button
                  type="button"
                  className="preview-menu-item"
                  disabled={!currentUrl}
                  onClick={() => {
                    if (webviewRef.current?.isDevToolsOpened()) {
                      webviewRef.current.closeDevTools();
                    } else {
                      webviewRef.current?.openDevTools();
                    }
                    setMoreMenuOpen(false);
                  }}
                >
                  Open DevTools
                </button>

                <div className="preview-menu-divider" />

                <div className="preview-zoom-row">
                  <span>Zoom</span>
                  <div className="preview-zoom-controls">
                    <button
                      type="button"
                      className="preview-zoom-btn"
                      title="Zoom out"
                      onClick={handleZoomOut}
                      disabled={zoomFactor <= 0.5}
                    >
                      <MinusIcon size={11} />
                    </button>
                    <span className="preview-zoom-value">{Math.round(zoomFactor * 100)}%</span>
                    <button
                      type="button"
                      className="preview-zoom-btn"
                      title="Zoom in"
                      onClick={handleZoomIn}
                      disabled={zoomFactor >= 3.0}
                    >
                      <PlusIcon size={11} />
                    </button>
                    <button
                      type="button"
                      className="preview-zoom-btn"
                      title="Reset zoom"
                      onClick={handleResetZoom}
                      disabled={zoomFactor === 1.0}
                    >
                      <RefreshIcon size={10} />
                    </button>
                  </div>
                </div>

                <div className="preview-menu-divider" />

                <button
                  type="button"
                  className="preview-menu-item"
                  disabled={!currentUrl}
                  onClick={() => {
                    onOpenExternal(currentUrl);
                    setMoreMenuOpen(false);
                  }}
                >
                  Open in system browser
                </button>
                <button
                  type="button"
                  className="preview-menu-item"
                  onClick={() => {
                    setCurrentUrl("");
                    setCanGoBack(false);
                    setCanGoForward(false);
                    setMoreMenuOpen(false);
                  }}
                >
                  <span className="preview-menu-item-row">
                    <span>Local servers home</span>
                    <GlobeIcon size={12} />
                  </span>
                </button>

                <div className="preview-menu-divider" />

                <button
                  type="button"
                  className="preview-menu-item"
                  disabled={!currentUrl}
                  onClick={() => void handleClearCache()}
                >
                  Clear cache
                </button>
                <button
                  type="button"
                  className="preview-menu-item"
                  disabled={!currentUrl}
                  onClick={() => void handleClearCookies()}
                >
                  Clear cookies &amp; storage
                </button>
              </div>
            )}
          </div>
        </div>

        {loading && <div className="preview-loading-bar" />}
      </div>

      {error ? <div className="browser-error">{error}</div> : null}

      {toast && (
        <div className="preview-toast">
          <CheckIcon size={12} />
          <span>{toast}</span>
        </div>
      )}

      {currentUrl ? (
        <div className="embedded-browser-frame">
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
