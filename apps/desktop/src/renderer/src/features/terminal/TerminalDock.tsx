import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { TerminalDataEvent, TerminalExitEvent, TerminalHandle } from "@capsule/shared";
import { conversationFolderRoots, localTimings } from "@capsule/shared";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

import { PlusIcon, TerminalIcon, XIcon } from "../shell/icons";
import { projectFolderName } from "../../lib/paths";
import { useWorkspace } from "../../lib/workspace";
import { showNativeContextMenu } from "../../lib/bridge";
import { registerSelectionReader, selectionContext, touchSelectionSurface } from "../../lib/selection-share";
import { onTerminalCommand, takeTerminalCommand } from "../../lib/terminal-requests";
import { osc7Folder, type TerminalLinkTarget } from "../../lib/terminal-links";
import { insertBlock, terminalSnippet } from "../../lib/terminal-selection";
import { registerTerminalLinks } from "./terminalLinks";
import "./terminal.css";

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
export function TerminalDock({ cwd, onClose, onEmpty, visible = true }: { cwd: string; onClose: () => void; onEmpty?: () => void; visible?: boolean }) {
  const { api, attachContext, project, session, setBrowserUrl, openInspector, openFile, setDraft } = useWorkspace();
  const mac = (api.platform ?? (navigator.platform.startsWith("Mac") ? "darwin" : "")) === "darwin";
  /*
   * xterm keeps one link provider for a pane's life, so it reads the current
   * conversation through a ref: switching to another thread in the same folder
   * must change where a click goes, not keep the first thread's handlers.
   */
  const links = useRef({ roots: [] as string[], setBrowserUrl, openInspector, openFile, setDraft });
  links.current = { roots: project ? conversationFolderRoots(project, session?.workingDirectory) : [], setBrowserUrl, openInspector, openFile, setDraft };
  const shellFolders = useRef(new Map<string, string>());
  const [hint, setHint] = useState<{ text: string; x: number; y: number }>();
  const [chip, setChip] = useState<{ paneId: string; x: number; y: number }>();
  const panesBox = useRef<HTMLDivElement>(null);
  const selecting = useRef(false);
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
  const readyPanes = useRef(new Set<string>());
  const openingPanes = useRef(0);
  useEffect(() => {
    for (const pane of panes) {
      if (readyPanes.current.has(pane.id)) continue;
      readyPanes.current.add(pane.id);
      void api.terminalAcknowledge?.(pane.id, 0).catch((error) => setError(String(error)));
    }
  }, [api, panes]);

  /** Starts a shell and its emulator. The caller decides where the pane goes. */
  const createPane = useCallback(async (): Promise<Pane> => {
    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily:
        "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 1000,
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
    terminal.parser.registerOscHandler(7, (data) => {
      const folder = osc7Folder(data);
      if (folder) shellFolders.current.set(handle.id, folder);
      return false;
    });
    registerTerminalLinks(terminal, {
      context: () => ({ cwd: shellFolders.current.get(handle.id) ?? cwd, roots: links.current.roots }),
      modifier: { label: mac ? "⌘" : "Ctrl", held: (event) => mac ? event.metaKey : event.ctrlKey },
      open: (target, outside) => openLinkRef.current(target, outside),
      hover: (next) => setHint(next && placeHintRef.current(next)),
    });
    terminal.onSelectionChange(() => { if (!selecting.current) placeChipRef.current(handle.id); });
    terminal.onScroll(() => placeChipRef.current(handle.id));
    terminal.attachCustomKeyEventHandler((event) => {
      const chord = mac ? event.metaKey && !event.shiftKey : event.ctrlKey && event.shiftKey;
      if (event.type !== "keydown" || !chord || event.key.toLowerCase() !== "l" || !terminal.hasSelection()) return true;
      event.preventDefault();
      addToChatRef.current(handle.id);
      return false;
    });
    return { id: handle.id, label: projectFolderName(cwd) ?? "Shell", terminal, fit, exited: false };
    // Everything else it reads is a ref; `mac` follows a platform that never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, cwd]);

  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  /* Typed, never run: the person reads the command and presses Return. */
  const typeInto = useCallback((pane: Pane, command: string) => {
    void api.terminalInput(pane.id, command).catch((error) => setError(String(error)));
  }, [api]);

  const openPane = useCallback(async (): Promise<Pane | undefined> => {
    if (panesRef.current.length + openingPanes.current >= 8) {
      setError("This folder has eight shell tabs. Close a tab before opening another.");
      return undefined;
    }
    openingPanes.current++;
    try {
      const pane = await createPane();
      if (!alive.current) { void api.terminalStop(pane.id); pane.terminal.dispose(); return; }
      setError(undefined);
      panesRef.current = [...panesRef.current, pane];
      setPanes(panesRef.current);
      setActiveId(pane.id);
      return pane;
    } catch (error) { if (alive.current) setError(String(error)); return undefined; }
    finally { openingPanes.current--; }
  }, [api, createPane]);

  const disposePane = useCallback(
    (pane: Pane) => {
      void api.terminalStop(pane.id);
      pane.terminal.dispose();
      hosts.current.delete(pane.id);
      readyPanes.current.delete(pane.id);
      shellFolders.current.delete(pane.id);
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
    openingPanes.current++;
    void createPane().then((pane) => {
      if (unmounted) {
        disposePane(pane);
        return;
      }
      panesRef.current = [...panesRef.current, pane];
      setPanes(panesRef.current);
      setActiveId(pane.id);
      // Opened to run something: the first shell takes it.
      const command = visibleRef.current ? takeTerminalCommand() : undefined;
      if (command) typeInto(pane, command);
    }).catch((error) => { if (!unmounted) setError(String(error)); })
      .finally(() => { openingPanes.current--; });
    return () => {
      alive.current = false;
      unmounted = true;
      for (const pane of panesRef.current) disposePane(pane);
      panesRef.current = [];
      setPanes([]);
      setActiveId(undefined);
    };
  }, [createPane, disposePane, typeInto]);

  /*
   * A command for a dock already on screen gets a shell of its own, so it
   * never lands in the middle of whatever the open one is running. While the
   * first shell is still starting, the request waits for it instead.
   */
  useEffect(() => {
    if (!visible) return;
    const run = (command: string) => void openPane().then((pane) => { if (pane) typeInto(pane, command); });
    if (panesRef.current.length > 0) {
      const waiting = takeTerminalCommand();
      if (waiting) run(waiting);
    }
    return onTerminalCommand((command) => {
      if (panesRef.current.length === 0) return false;
      run(command);
      return true;
    });
  }, [visible, openPane, typeInto]);

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
      const pane = panesRef.current.find((pane) => pane.id === event.id);
      if (!pane) return;
      const rendered = localTimings.start("terminal.render");
      pane.terminal.write(event.data, () => {
        rendered();
        if (alive.current && event.sequence !== undefined) {
          void api.terminalAcknowledge(pane.id, event.sequence).catch((error) => setError(String(error)));
        }
      });
    });
    const offExit = api.on("terminalExit", (payload) => {
      const event = payload as TerminalExitEvent;
      if (!panesRef.current.some((pane) => pane.id === event.id)) return;
      if (event.error) setError(event.error);
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
      if (activeId) placeChipRef.current(activeId);
    };
    // The pane box, not the window: opening the side panel narrows the dock too.
    const box = panesBox.current;
    if (!box) return;
    const observer = new ResizeObserver(onResize);
    observer.observe(box);
    return () => observer.disconnect();
  }, [activeId]);

  const closePane = useCallback(
    (id: string) => {
      const pane = panesRef.current.find((item) => item.id === id);
      if (!pane) return;
      disposePane(pane);
      const rest = panesRef.current.filter((item) => item.id !== id);
      panesRef.current = rest;
      setPanes(rest);
      if (rest.length === 0) (onEmpty ?? onClose)();
      else setActiveId((currentId) => currentId === id ? rest[rest.length - 1]!.id : currentId);
    },
    [disposePane, onClose, onEmpty],
  );

  const openLink = (target: TerminalLinkTarget, outside: boolean) => {
    if (target.kind === "file") {
      links.current.openFile(target.path, target.root);
      return;
    }
    if (outside) {
      window.open(target.url, "_blank", "noopener");
      return;
    }
    links.current.setBrowserUrl(target.url);
    links.current.openInspector("browser");
  };
  const openLinkRef = useRef(openLink);
  openLinkRef.current = openLink;

  /** Hints and the chip live inside the pane box, so they clip and move with it. */
  const placeHint = (next: { text: string; x: number; y: number }) => {
    const box = panesBox.current?.getBoundingClientRect();
    if (!box) return undefined;
    return { text: next.text, x: Math.max(0, Math.min(next.x - box.left, box.width - 300)), y: next.y - box.top };
  };
  const placeHintRef = useRef(placeHint);
  placeHintRef.current = placeHint;

  const placeChip = (paneId: string) => {
    const pane = panesRef.current.find((item) => item.id === paneId);
    const box = panesBox.current?.getBoundingClientRect();
    const screen = hosts.current.get(paneId)?.querySelector(".xterm-screen")?.getBoundingClientRect();
    const position = pane?.terminal.getSelectionPosition();
    if (!pane || !box || !screen || !position || !pane.terminal.getSelection().trim()) {
      setChip((current) => current?.paneId === paneId ? undefined : current);
      return;
    }
    const { cols, rows } = pane.terminal;
    const cellWidth = screen.width / cols;
    const cellHeight = screen.height / rows;
    const row = Math.min(rows - 1, Math.max(0, position.end.y - pane.terminal.buffer.active.viewportY));
    const below = (row + 1) * cellHeight + 4;
    const y = screen.top - box.top + (below + 26 > screen.height ? Math.max(0, row * cellHeight - 28) : below);
    const x = screen.left - box.left + Math.min(Math.max(0, position.end.x * cellWidth - 40), screen.width - 130);
    setChip({ paneId, x, y });
  };
  const placeChipRef = useRef(placeChip);
  placeChipRef.current = placeChip;

  const addToChat = (paneId: string) => {
    const index = panesRef.current.findIndex((item) => item.id === paneId);
    const pane = panesRef.current[index];
    if (!pane) return;
    const label = panesRef.current.length > 1 ? `${pane.label} (tab ${index + 1})` : pane.label;
    const snippet = terminalSnippet(pane.terminal.getSelection(), label);
    if (!snippet) return;
    const field = document.querySelector<HTMLTextAreaElement>("textarea.composer-field");
    let caret = 0;
    links.current.setDraft((current) => {
      // A restored draft that was never clicked into reports its caret at 0; that is no choice.
      const placed = field && field.value === current && (field.selectionEnd > 0 || document.activeElement === field);
      const at = placed ? field.selectionEnd : current.length;
      const next = insertBlock(current, at, snippet.text);
      caret = next.caret;
      return next.draft;
    });
    pane.terminal.clearSelection();
    setChip(undefined);
    // The draft commits on the next render; the caret goes after the block once it has.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!field?.isConnected) return;
      field.focus();
      field.setSelectionRange(caret, caret);
    }));
  };
  const addToChatRef = useRef(addToChat);
  addToChatRef.current = addToChat;

  useEffect(() => {
    if (activeId) placeChipRef.current(activeId);
    else setChip(undefined);
  }, [activeId, height]);

  const onPaneMouseDown = (event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    selecting.current = true;
    setChip(undefined);
    const done = () => {
      selecting.current = false;
      window.removeEventListener("mouseup", done);
      if (activeId) requestAnimationFrame(() => placeChipRef.current(activeId));
    };
    window.addEventListener("mouseup", done);
  };

  const onPaneContextMenu = async (event: ReactMouseEvent, pane: Pane) => {
    event.preventDefault();
    const selection = pane.terminal.hasSelection();
    const picked = await showNativeContextMenu([
      { id: "add", label: "Add Selection to Chat", enabled: selection },
      ...(api.isDesktop === true ? [{ id: "send", label: "Send Selection to Thread", enabled: selection }] : []),
      { id: "copy", label: "Copy", enabled: selection, separatorBefore: true },
      { id: "paste", label: "Paste" },
      { id: "clear", label: "Clear", separatorBefore: true },
    ], { x: event.clientX, y: event.clientY });
    if (picked === "add") addToChat(pane.id);
    else if (picked === "send") void attachContext(selectionContext({ origin: "terminal", text: pane.terminal.getSelection() }));
    else if (picked === "copy") void navigator.clipboard.writeText(pane.terminal.getSelection()).catch(() => undefined);
    else if (picked === "paste") void navigator.clipboard.readText().then((text) => pane.terminal.paste(text)).catch(() => undefined);
    else if (picked === "clear") pane.terminal.clear();
    if (picked && picked !== "add" && picked !== "send" && picked !== "unavailable") pane.terminal.focus();
  };

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
  const activePane = panes.find((pane) => pane.id === activeId);
  useEffect(() => {
    if (!visible || !activePane || api.isDesktop !== true) return;
    return registerSelectionReader("terminal", () => {
      const text = activePane.terminal.getSelection();
      return text.trim() ? { origin: "terminal", text } : undefined;
    });
  }, [activePane, api.isDesktop, visible]);

  const heightRef = useRef(height);
  heightRef.current = height;

  return (
    <section className="terminal-dock" style={{ height }} aria-label="Terminal" data-keymap-context="terminal">
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
      <div className="terminal-panes" ref={panesBox} onPointerDown={() => touchSelectionSurface("terminal")}>
        {panes.map((pane) => (
          <div
            key={pane.id}
            className={`terminal-pane${pane.id === activeId ? " active" : ""}`}
            ref={(node) => {
              if (node) hosts.current.set(pane.id, node);
            }}
            onMouseDown={onPaneMouseDown}
            onContextMenu={(event) => void onPaneContextMenu(event, pane)}
          />
        ))}
        {chip && chip.paneId === activeId && (
          <button
            type="button"
            className="terminal-add-to-chat"
            style={{ left: chip.x, top: chip.y }}
            title="Add the selection to this conversation's message"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => addToChat(chip.paneId)}
          >
            Add to chat
            <kbd>{mac ? "⌘L" : "Ctrl+Shift+L"}</kbd>
          </button>
        )}
        {hint && <div className="terminal-link-hint" role="tooltip" style={{ left: hint.x, top: hint.y + 14 }}>{hint.text}</div>}
      </div>
    </section>
  );
}

/** Folder ownership outlives a view; no shell is moved into another cwd. */
export function PersistentTerminals({ cwd, visible, onClose }: { cwd?: string; visible: boolean; onClose: () => void }) {
  const [roots, setRoots] = useState<string[]>([]);
  useEffect(() => {
    if (visible && cwd) setRoots((current) => current.includes(cwd) || current.length >= 16 ? current : [...current, cwd]);
  }, [cwd, visible]);
  return <>{visible && cwd && !roots.includes(cwd) && roots.length >= 16 && <p role="status">Terminal folder limit reached. Close all shell tabs in another folder before opening this one.</p>}
  {roots.map((root) => <div key={root} hidden={!visible || root !== cwd}>
    <TerminalDock cwd={root} visible={visible && root === cwd} onClose={onClose} onEmpty={() => {
      setRoots((current) => current.filter((item) => item !== root));
      if (root === cwd) onClose();
    }} />
  </div>)}</>;
}

/** xterm cannot read CSS variables, so the theme is sampled from the page. */
function terminalTheme(): Record<string, string> {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  /*
   * The surface tokens are translucent `rgb(0 0 0 / 0.06)`, which xterm cannot
   * parse; it falls back to a dark selection that hides black text in light
   * mode. The selection is mixed on a canvas into one opaque colour instead.
   */
  const solidSelection = () => {
    const canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!canvas) return "#5a5a5a";
    canvas.fillStyle = read("--base", "#1a1a1a");
    canvas.fillRect(0, 0, 1, 1);
    canvas.globalAlpha = 0.22;
    canvas.fillStyle = read("--text", "#f2f2f2");
    canvas.fillRect(0, 0, 1, 1);
    const [red, green, blue] = canvas.getImageData(0, 0, 1, 1).data;
    return `rgb(${red}, ${green}, ${blue})`;
  };
  return {
    background: "#00000000",
    foreground: read("--text", "#f2f2f2"),
    cursor: read("--text", "#f2f2f2"),
    selectionBackground: solidSelection(),
    black: read("--bg-active", "#1f1f1f"),
    red: read("--red", "#d98989"),
    green: read("--green", "#8fbf88"),
    yellow: read("--yellow", "#d6c37a"),
    blue: read("--blue", "#b0b0aa"),
    brightBlack: read("--overlay-0", "#5f5f5f"),
  };
}
