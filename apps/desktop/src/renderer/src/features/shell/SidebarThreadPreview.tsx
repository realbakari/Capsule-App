import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { compactRelativeTime } from "../../lib/sidebar";
import { FolderIcon } from "./icons";

export function SidebarThreadPreview({ id, title, project, updatedAt, detail, disabled, children }: {
  id: string;
  title: string;
  project?: string;
  updatedAt?: string;
  detail?: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [active, setActive] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const close = () => {
    clearTimeout(timer.current);
    setPosition(undefined);
    setActive(false);
  };
  const show = () => {
    if (disabled) return;
    clearTimeout(timer.current);
    setActive(true);
    timer.current = setTimeout(() => {
      const row = anchor.current?.firstElementChild;
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 16);
      setPosition({
        left: Math.max(8, Math.min(rect.right + 8, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(rect.top, window.innerHeight - 104)),
      });
    }, 450);
  };
  useEffect(() => {
    if (disabled) { clearTimeout(timer.current); setActive(false); setPosition(undefined); }
  }, [disabled]);
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node || !position) return;
    node.style.top = `${Math.max(8, Math.min(position.top, window.innerHeight - node.offsetHeight - 8))}px`;
    node.style.left = `${Math.max(8, Math.min(position.left, window.innerWidth - node.offsetWidth - 8))}px`;
  }, [position, title, project]);
  useEffect(() => {
    if (!active) return;
    const dismiss = () => { clearTimeout(timer.current); setPosition(undefined); setActive(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", key);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("keydown", key);
    };
  }, [active]);
  return <div ref={anchor} className="sidebar-preview-anchor" onMouseEnter={show} onMouseLeave={close}
    onFocus={(event) => { if (event.target === anchor.current?.firstElementChild) show(); else close(); }}
    onBlur={close} onPointerDown={close} onClickCapture={close}>
    {children}
    {position && !disabled && createPortal(<div ref={panel} id={id} role="tooltip" className="sidebar-thread-preview" style={position}>
      <div>{title}</div>
      <div className="sidebar-preview-context"><FolderIcon size={14} /><span>{project ?? "Project"}</span>
        {updatedAt && <time dateTime={updatedAt}>{compactRelativeTime(updatedAt)}</time>}</div>
      {detail && <div className="sidebar-preview-detail">{detail}</div>}
    </div>, document.body)}
  </div>;
}
