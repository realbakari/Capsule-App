import type { WebviewTag } from "electron";
import { useWorkspace } from "../../lib/workspace";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalServer } from "@capsule/shared";
import { harnessCapabilities } from "@capsule/shared";
import { BackgroundBrowser } from "./BackgroundBrowser";
import { BrowserControls } from "./BrowserControls";
// Electron's custom element reads a string attribute. React drops boolean
// `true` on this non-standard attribute despite WebViewHTMLAttributes' type.
const guestAttributes: Record<string, string> = { allowpopups: "true" };
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CameraIcon,
  ExternalLinkIcon,
  GlobeIcon,
  MinusIcon,
  MoreVerticalIcon,
  MousePointerClickIcon,
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

const ELEMENT_PICKER_SCRIPT = String.raw`
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
        let id = currentTarget.id ? '#' + CSS.escape(currentTarget.id) : '';
        let cls = currentTarget.className && typeof currentTarget.className === 'string'
          ? '.' + currentTarget.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map(value => CSS.escape(value)).join('.')
          : '';
        let selector = tag + id + cls;
        if (document.querySelectorAll(selector).length !== 1) {
          const parts = [];
          let element = currentTarget;
          while (element && parts.length < 12) {
            const tagName = element.tagName.toLowerCase();
            const siblings = [...(element.parentElement?.children || [])].filter(item => item.tagName === element.tagName);
            parts.unshift(tagName + ':nth-of-type(' + (siblings.indexOf(element) + 1) + ')');
            element = element.parentElement;
          }
          selector = parts.join(' > ');
        }
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
    return parsed.slice(0, 100).flatMap((entry): BrowserRecent[] => {
      if (!entry || typeof entry !== "object" || typeof entry.url !== "string" || typeof entry.title !== "string" ||
        typeof entry.lastUsedAt !== "string" || !Number.isFinite(Date.parse(entry.lastUsedAt))) return [];
      try {
        const url = new URL(entry.url);
        if (!["http:", "https:"].includes(url.protocol) || url.href.length > 2048) return [];
        url.username = ""; url.password = "";
        return [{ url: url.href, title: entry.title.slice(0, 512), lastUsedAt: entry.lastUsedAt }];
      } catch { return []; }
    }).slice(0, MAX_RECENTS);
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
  if (!trimmed || trimmed.length > 2048) return "";
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(trimmed) && !/^https?:/i.test(trimmed)) return "";
  if (!/^https?:/i.test(trimmed) && /\s/.test(trimmed)) return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  const local = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)(?=[:/]|$)/i.test(trimmed);
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `${local ? "http" : "https"}://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    return !parsed.username && !parsed.password && (parsed.protocol === "http:" || parsed.protocol === "https:") ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export function EmbeddedBrowser({
  address,
  onAddressChange,
  localServers,
  serversLoading,
  serversError,
  onRetryServers,
  onOpenExternal,
}: {
  address: string;
  onAddressChange: (value: string) => void;
  localServers: LocalServer[];
  serversLoading: boolean;
  serversError?: string;
  onRetryServers?: () => void;
  onOpenExternal: (url: string) => void;
}) {
  const { api, session, agentId, harnesses, harnessStatuses, view: workspaceView, inspectorOpen } = useWorkspace();
  const desktopBrowser = navigator.userAgent.includes("Electron/");
  const browserCapability = harnessCapabilities({ harness: harnesses?.find((item) => item.id === agentId), session, status: session ? harnessStatuses?.[session.id] : undefined }).browser;
  const initialUrl = normalizedBrowserUrl(address);
  const [agentControl, setAgentControl] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [viewport, setViewport] = useState("fill");
  const controlEpoch = useRef(0);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  // Keep the guest's initial src stable across committed navigations.
  const [guestUrl, setGuestUrl] = useState(initialUrl);
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
  const [mountedView, setMountedView] = useState<WebviewTag | null>(null);
  const attachView = useCallback((view: WebviewTag | null) => {
    webviewRef.current = view;
    setMountedView(view);
  }, []);
  const publishedAddress = useRef(address);
  const ownerId = session?.id;
  const moreMenuAnchorRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!desktopBrowser) return;
    let disposed = false;
    void api.registerBrowserView?.(undefined, ownerId).catch((error) => {
      if (!disposed) setError(String(error));
    });
    return () => {
      disposed = true;
      controlEpoch.current++;
      if (ownerId) void api.setBrowserControl?.(ownerId, false).catch(() => undefined);
      window.clearTimeout(toastTimerRef.current);
    };
  }, [api, ownerId, desktopBrowser]);

  useEffect(() => {
    if (!ownerId || !desktopBrowser || (workspaceView !== undefined && workspaceView !== "chat") || inspectorOpen === false) {
      controlEpoch.current++;
      setAgentControl(false);
      if (ownerId && desktopBrowser) void api.setBrowserControl?.(ownerId, false).catch(() => undefined);
    }
  }, [api, ownerId, desktopBrowser, workspaceView, inspectorOpen]);

  const toggleAgentControl = async () => {
    if (!ownerId) return;
    const epoch = controlEpoch.current;
    setControlBusy(true);
    try {
      await api.setBrowserControl(ownerId, !agentControl);
      if (epoch === controlEpoch.current) setAgentControl(!agentControl);
    } catch (error) { setError(String(error)); }
    finally { setControlBusy(false); }
  };

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
    if (webviewRef.current) void webviewRef.current.loadURL(next).catch((error) => setError(String(error)));
    else { setGuestUrl(next); setCurrentUrl(next); }
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
    const view = mountedView;
    if (!view) return undefined;
    const started = () => {
      setPickActive(false);
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
      if (next && (event as Event & { isMainFrame?: boolean }).isMainFrame !== false) {
        setCurrentUrl(next);
        publishAddress(next);
      }
      syncNavigation();
    };
    const failed = (event: Event) => {
      const detail = event as Event & { errorCode?: number; errorDescription?: string; isMainFrame?: boolean };
      if (detail.errorCode === -3 || detail.isMainFrame === false) return;
      setLoading(false);
      setError(detail.errorDescription || "This page could not be loaded.");
    };
    const crashed = () => { setLoading(false); setReady(false); setError("The page process stopped. Reload to recover it."); };
    view.addEventListener("render-process-gone", crashed);
    view.addEventListener("did-start-loading", started);
    view.addEventListener("did-stop-loading", stopped);
    /*
     * Tell the main process which guest this pane owns, so the agent's browser
     * tools can drive it directly. Registered on attach and cleared on unmount:
     * a stale id would point at a page nobody is looking at any more.
     */
    const register = (domReady = false) => {
      try {
        if (domReady) { setReady(true); setZoomFactor(view.getZoomFactor()); }
        void api.registerBrowserView?.(view.getWebContentsId(), ownerId, domReady).catch((error) => setError(`Browser tools could not connect: ${String(error)}`));
      } catch {
        // The guest is not attached yet; dom-ready will come round again.
      }
    };
    const onReady = () => register(true);
    view.addEventListener("dom-ready", onReady);
    register();
    view.addEventListener("did-navigate", navigated);
    view.addEventListener("did-navigate-in-page", navigated);
    view.addEventListener("page-title-updated", rememberCurrentPage);
    view.addEventListener("did-fail-load", failed);
    return () => {
      view.removeEventListener("render-process-gone", crashed);
      view.removeEventListener("did-start-loading", started);
      view.removeEventListener("did-stop-loading", stopped);
      view.removeEventListener("dom-ready", onReady);
      setReady(false);
      void api.registerBrowserView?.(undefined, ownerId).catch(() => undefined);
      view.removeEventListener("did-navigate", navigated);
      view.removeEventListener("did-navigate-in-page", navigated);
      view.removeEventListener("page-title-updated", rememberCurrentPage);
      view.removeEventListener("did-fail-load", failed);
    };
  }, [mountedView, api, publishAddress, ownerId]);

  const navigate = (value: string) => {
    const next = normalizedBrowserUrl(value);
    if (!next) {
      setError("Enter a valid HTTP or HTTPS address.");
      return;
    }
    setError(undefined);
    publishAddress(next);
    if (webviewRef.current) void webviewRef.current.loadURL(next).catch((error) => setError(String(error)));
    else { setGuestUrl(next); setCurrentUrl(next); }
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
    } catch (error) {
      setPickActive(false);
      showToast(`Element inspection failed: ${String(error)}`);
    }
  };

  const handleCaptureScreenshot = async () => {
    const view = webviewRef.current;
    if (!view || !currentUrl) return;

    try {
      await api.copyBrowserScreenshot(view.getWebContentsId());
      showToast("Screenshot copied to clipboard");
    } catch (failure) {
      showToast(`Could not copy screenshot: ${failure instanceof Error ? failure.message : String(failure)}`);
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
      await api.clearBrowserData(view.getWebContentsId(), "cache");
      showToast("Browser HTTP cache cleared");
    } catch {
      showToast("Unable to clear cache");
    }
    setMoreMenuOpen(false);
  };

  const handleClearCookies = async () => {
    const view = webviewRef.current;
    if (!view) return;
    if (!window.confirm("Clear cookies and site storage for all Capsule browser pages? This signs you out of those sites. Capsule projects and drafts are kept.")) return;
    try {
      await api.clearBrowserData(view.getWebContentsId(), "storage");
      view.reload();
      showToast("Browser cookies and site storage cleared");
    } catch {
      showToast("Unable to clear cookies");
    }
    setMoreMenuOpen(false);
  };

  if (!desktopBrowser) return (
    <div className="codex-tool-pane"><BackgroundBrowser desktop={false} url="" available={false} active={inspectorOpen !== false} /></div>
  );

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
            aria-label="Browser address"
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
          <BrowserControls allowed={agentControl} disabled={!ownerId || controlBusy || browserCapability.state === "unavailable"}
            detail={browserCapability.detail} url={normalizedBrowserUrl(address)}
            active={inspectorOpen !== false && (workspaceView === undefined || workspaceView === "chat")}
            backgroundAvailable={browserCapability.state !== "unavailable" && Boolean(session?.harnessId && session.openclawSessionKey?.startsWith("direct:"))}
            onToggle={() => void toggleAgentControl()} onBackgroundControl={() => setAgentControl(false)} />
          <button
            className={`preview-chrome-btn ${pickActive ? "active" : ""}`}
            type="button"
            aria-label="Inspect element"
            title={pickActive ? "Cancel inspection (Esc)" : "Inspect element"}
            disabled={!ready}
            onClick={handlePickElement}
          >
            <MousePointerClickIcon size={14} />
          </button>

          <button
            className="preview-chrome-btn"
            type="button"
            aria-label="Capture screenshot"
            title="Capture screenshot"
            disabled={!ready}
            onClick={() => void handleCaptureScreenshot()}
          >
            <CameraIcon size={14} />
          </button>

          <select className="preview-viewport" aria-label="Preview viewport" value={viewport} onChange={(event) => setViewport(event.target.value)}>
            <option value="fill">Fit panel</option><option value="phone">Phone · 390px</option><option value="tablet">Tablet · 768px</option>
          </select>

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
                  disabled={!ready}
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
                  disabled={!ready}
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
                  disabled={!ready}
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
                    setGuestUrl("");
                    setPickActive(false);
                    setLoading(false);
                    setError(undefined);
                    publishAddress("");
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
                  disabled={!ready}
                  onClick={() => void handleClearCache()}
                >
                  Clear browser HTTP cache
                </button>
                <button
                  type="button"
                  className="preview-menu-item"
                  disabled={!ready}
                  onClick={() => void handleClearCookies()}
                >
                  Clear browser cookies &amp; storage
                </button>
              </div>
            )}
          </div>
        </div>

        {loading && <div className="preview-loading-bar" />}
      </div>

      {error ? <div className="browser-error" role="alert"><span>{error}</span>{currentUrl && <button type="button" className="chip" onClick={() => navigate(currentUrl)}>Retry page</button>}</div> : null}

      {toast && (
        <div className="preview-toast" role="status">
          <span>{toast}</span>
        </div>
      )}

      {currentUrl ? (
        <div className="embedded-browser-frame" data-viewport={viewport}>
          <webview
            ref={attachView}
            className="embedded-browser-webview"
            src={guestUrl}
            partition="persist:capsule-browser"
            {...guestAttributes}
            webpreferences="contextIsolation=true,nodeIntegration=false,sandbox=true"
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
              <span className={serversLoading ? "dot warn live" : serversError ? "dot warn" : "dot on"} aria-hidden />
            </div>
            {serversError ? <div className="notice" role="alert">
              <span>Could not refresh local servers: {serversError}</span>
              {onRetryServers && <button type="button" className="chip" disabled={serversLoading} onClick={onRetryServers}>Retry</button>}
            </div> : null}
            {localServers.length === 0 && !serversLoading && !serversError ? (
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
