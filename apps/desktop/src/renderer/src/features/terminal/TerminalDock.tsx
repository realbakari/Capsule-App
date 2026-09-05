import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { TerminalDataEvent, TerminalExitEvent, TerminalHandle } from "@capsule/shared";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

import { PlusIcon, TerminalIcon, XIcon } from "../shell/icons";
import { projectFolderName } from "../../lib/paths";
import { useWorkspace } from "../../lib/workspace";

const MIN_HEIGHT = 140;
const MAX_HEIGHT = 720;
const DEFAULT_HEIGHT = 260;
const HEIGHT_KEY = "capsule.terminal.height";

interface Pane {
  id: string;
  label: string;
  terminal: Terminal;
  fit: FitAddon;
  exited: boolean;
}

/**
 * Shells inside Capsule, docked under the conversation.
 *
 * The pty lives in the main process; this owns the emulator and forwards
 * keystrokes by id. Panes are kept mounted and hidden rather than unmounted,
 * because tearing down an xterm loses the scrollback and the running command.
 */
export function TerminalDock({ cwd, onClose, visible = true }: { cwd: string; onClose: () => void; visible?: boolean }) {
  const { api } = useWorkspace();
  const [error, setError] = useState<string>();
  const alive = useRef(true);
  const [panes, setPanes] = useState<Pane[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [height, setHeight] = useState(() => {
    const stored = Number(localStorage.getItem(HEIGHT_KEY));
    return Number.isFinite(stored) && stored >= MIN_HEIGHT ? Math.min(stored, MAX_HEIGHT) : DEFAULT_HEIGHT;
  });
  const hosts = useRef(new Map<string, HTMLDivElement>());
  const panesRef = useRef<Pane[]>([]);
  panesRef.current = panes;

  /** Starts a shell and its emulator. The caller decides where the pane goes. */
  const createPane = useCallback(async (): Promise<Pane> => {
    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily:
        "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
      fontSize: 12,
      lineHeight: 1.2,
      // The panel reads as part of the app, not a pasted-in black rectangle.
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    let handle: TerminalHandle;
    try { handle = await api.terminalStart({ cwd, cols: 80, rows: 24 }) as TerminalHandle; }
    catch (error) { terminal.dispose(); throw error; }
    terminal.onData((data) => void api.terminalInput(handle.id, data).catch((error) => setError(String(error))));
    terminal.onResize(({ cols, rows }) => void api.terminalResize(handle.id, cols, rows));
    return { id: handle.id, label: projectFolderName(cwd) ?? "Shell", terminal, fit, exited: false };
  }, [api, cwd]);

  const openPane = useCallback(async () => {
    try {
      const pane = await createPane();
      if (!alive.current) { void api.terminalStop(pane.id); pane.terminal.dispose(); return; }
      setError(undefined);
      setPanes((current) => [...current, pane]);
      setActiveId(pane.id);
    } catch (error) { if (alive.current) setError(String(error)); }
  }, [api, createPane]);

  const disposePane = useCallback(
    (pane: Pane) => {
      void api.terminalStop(pane.id);
      pane.terminal.dispose();
      hosts.current.delete(pane.id);
    },
    [api],
  );

  /*
   * One shell for the life of this folder's dock. Hiding and navigation keep
   * the dock mounted; closing a shell or the app ends it.
   *
   * The first shell is started here rather than in a guarded effect because
   * starting one is asynchronous: a guard that reads pane state still sees an
   * empty list on a second pass and opens a second tab. Mount owns the pane,
   * unmount takes it away, and a shell that arrives after unmount is stopped
   * on the spot.
   */
  useEffect(() => {
    alive.current = true;
    let unmounted = false;
    void createPane().then((pane) => {
      if (unmounted) {
        disposePane(pane);
        return;
      }
      setPanes([pane]);
      setActiveId(pane.id);
    }).catch((error) => { if (!unmounted) setError(String(error)); });
    return () => {
      alive.current = false;
      unmounted = true;
      for (const pane of panesRef.current) disposePane(pane);
      setPanes([]);
      setActiveId(undefined);
    };
  }, [createPane, disposePane]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      try { panesRef.current.find((pane) => pane.id === activeId)?.fit.fit(); } catch { /* Layout may still be hidden. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, activeId]);

  useEffect(() => {
    const offData = api.on("terminalData", (payload) => {
      const event = payload as TerminalDataEvent;
      panesRef.current.find((pane) => pane.id === event.id)?.terminal.write(event.data);
    });
    const offExit = api.on("terminalExit", (payload) => {
      const event = payload as TerminalExitEvent;
      setPanes((current) =>
        current.map((pane) => (pane.id === event.id ? { ...pane, exited: true } : pane)),
      );
    });
    return () => {
      offData();
      offExit();
    };
  }, [api]);

  // Attach each pane to its host once, and fit it whenever the dock changes size.
  useEffect(() => {
    for (const pane of panes) {
      const host = hosts.current.get(pane.id);
      if (!host || host.childElementCount > 0) continue;
      pane.terminal.open(host);
    }
    const active = panes.find((pane) => pane.id === activeId);
    if (active) {
      requestAnimationFrame(() => {
        try {
          active.fit.fit();
          active.terminal.focus();
        } catch {
          // The pane can be measured before layout settles; the next fit wins.
        }
      });
    }
  }, [panes, activeId, height]);

  useEffect(() => {
    const onResize = () => {
      const active = panesRef.current.find((pane) => pane.id === activeId);
      try {
        active?.fit.fit();
      } catch {
        // Same as above: an unmeasurable pane is refit on the next change.
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [activeId]);

  const closePane = useCallback(
    (id: string) => {
      setPanes((current) => {
        const pane = current.find((item) => item.id === id);
        if (pane) disposePane(pane);
        const rest = current.filter((item) => item.id !== id);
        if (rest.length === 0) onClose();
        else setActiveId((currentId) => (currentId === id ? rest[rest.length - 1]!.id : currentId));
        return rest;
      });
    },
    [disposePane, onClose],
  );

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    const onMove = (move: PointerEvent) => {
      const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + (startY - move.clientY)));
      setHeight(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      localStorage.setItem(HEIGHT_KEY, String(Math.round(heightRef.current)));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const heightRef = useRef(height);
  heightRef.current = height;

  return (
    <section className="terminal-dock" style={{ height }} aria-label="Terminal">
      {error && <div role="alert" className="notice">{error}</div>}
      <div className="terminal-dock-rail" onPointerDown={startResize} />
      <div className="terminal-tabs">
        {panes.map((pane) => (
          <div
            key={pane.id}
            className={`terminal-tab${pane.id === activeId ? " active" : ""}${pane.exited ? " exited" : ""}`}
          >
            <button type="button" onClick={() => setActiveId(pane.id)}>
              <TerminalIcon size={12} />
              <span>{pane.label}</span>
              {pane.exited ? <small>exited</small> : null}
            </button>
            <button
              type="button"
              className="terminal-tab-close"
              aria-label={`Close ${pane.label}`}
              onClick={() => closePane(pane.id)}
            >
              <XIcon size={11} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="icon-btn"
          title="New shell"
          aria-label="New shell"
          onClick={() => void openPane()}
        >
          <PlusIcon size={13} />
        </button>
        <span className="grow" />
        <button
          type="button"
          className="icon-btn"
          title="Hide terminal (⌘J)"
          aria-label="Hide terminal"
          onClick={onClose}
        >
          <XIcon size={13} />
        </button>
      </div>
      <div className="terminal-panes">
        {panes.map((pane) => (
          <div
            key={pane.id}
            className={`terminal-pane${pane.id === activeId ? " active" : ""}`}
            ref={(node) => {
              if (node) hosts.current.set(pane.id, node);
            }}
          />
        ))}
      </div>
    </section>
  );
}

/** Folder ownership outlives a view; no shell is moved into another cwd. */
export function PersistentTerminals({ cwd, visible, onClose }: { cwd?: string; visible: boolean; onClose: () => void }) {
  const [roots, setRoots] = useState<string[]>([]);
  useEffect(() => {
    if (visible && cwd) setRoots((current) => current.includes(cwd) ? current : [...current, cwd]);
  }, [cwd, visible]);
  return <>{roots.map((root) => <div key={root} hidden={!visible || root !== cwd}>
    <TerminalDock cwd={root} visible={visible && root === cwd} onClose={onClose} />
  </div>)}</>;
}

/** xterm cannot read CSS variables, so the theme is sampled from the page. */
function terminalTheme(): Record<string, string> {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    background: "#00000000",
    foreground: read("--text", "#f2f2f2"),
    cursor: read("--text", "#f2f2f2"),
    selectionBackground: read("--bg-active", "#2a2a2a"),
    black: read("--surface-2", "#1f1f1f"),
    red: read("--red", "#d98989"),
    green: read("--green", "#8fbf88"),
    yellow: read("--yellow", "#d6c37a"),
    blue: read("--blue", "#b0b0aa"),
    brightBlack: read("--overlay-0", "#5f5f5f"),
  };
}
