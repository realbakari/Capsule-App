import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { LoginStream } from "./login-stream";

/** xterm cannot read CSS variables, so the few colours a login prints in are sampled from the page. */
function loginTheme(): Record<string, string> {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    background: "#00000000",
    foreground: read("--text", "#f2f2f2"),
    cursor: read("--text", "#f2f2f2"),
    red: read("--red", "#d98989"),
    green: read("--green", "#8fbf88"),
    yellow: read("--yellow", "#d6c37a"),
    blue: read("--blue", "#b0b0aa"),
    brightBlack: read("--overlay-0", "#5f5f5f"),
  };
}

/** The login program's own terminal, attached to a stream the sign-in dialog started. */
export function LoginTerminal({ stream, label }: { stream: LoginStream; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 1000,
      theme: loginTheme(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(node);
    const refit = () => { try { fit.fit(); } catch { /* Not laid out yet. */ } };
    refit();
    const detach = stream.attach((data) => terminal.write(data));
    const input = terminal.onData((data) => stream.input(data));
    const resize = terminal.onResize(({ cols, rows }) => stream.resize(cols, rows));
    stream.resize(terminal.cols, terminal.rows);
    const observer = new ResizeObserver(refit);
    observer.observe(node);
    terminal.focus();
    return () => {
      observer.disconnect();
      input.dispose();
      resize.dispose();
      detach();
      terminal.dispose();
    };
  }, [stream]);
  return <div className="login-terminal" ref={host} role="group" aria-label={label} data-keyboard-passthrough="" />;
}
