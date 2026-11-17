import { memo, useId, type ReactNode } from "react";
import { fileKind, type FileIconId } from "../../lib/file-kind";

const PAGE = "M4 1.75h4.9l3.35 3.35v8.65a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5v-11.5a.5.5 0 0 1 .5-.5Z";
const FOLD = "M8.75 1.75V5.25h3.5";

function Stroke({ children }: { children: ReactNode }) {
  return <g fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">{children}</g>;
}

/** A filled tile with its letters knocked out, so they read on any row background. */
function LetterTile({ text, round = 2.5 }: { text: string; round?: number }) {
  const mask = useId();
  return (
    <>
      <mask id={mask}>
        <rect x="1.5" y="1.5" width="13" height="13" rx={round} fill="white" />
        <text x="14" y="13" textAnchor="end" fontSize="7.25" fontWeight="800" letterSpacing="-0.4" fill="black" style={{ fontFamily: "var(--font)" }}>{text}</text>
      </mask>
      <rect x="1.5" y="1.5" width="13" height="13" rx={round} fill="currentColor" mask={`url(#${mask})`} />
    </>
  );
}

function GitMark() {
  const mask = useId();
  return (
    <>
      <mask id={mask}>
        <path d="M8 .9 15.1 8 8 15.1.9 8Z" fill="white" />
        <g fill="none" stroke="black" strokeWidth="1.5" strokeLinecap="round">
          <path d="M5.6 4.1 7.9 6.4v4.3M7.9 6.4l2.4 2.4" />
        </g>
        <circle cx="7.9" cy="10.9" r="1.35" fill="black" />
        <circle cx="10.4" cy="8.9" r="1.35" fill="black" />
      </mask>
      <path d="M8 .9 15.1 8 8 15.1.9 8Z" fill="currentColor" mask={`url(#${mask})`} />
    </>
  );
}

function Glyph({ icon }: { icon: FileIconId }) {
  switch (icon) {
    case "typescript": return <LetterTile text="TS" />;
    case "javascript": return <LetterTile text="JS" />;
    case "npm":
      return <path fill="currentColor" fillRule="evenodd" d="M1.75 1.75h12.5v12.5H1.75ZM4.25 4.25v7.5h3.5v-5h1.5v5h2.5v-7.5Z" />;
    case "pnpm":
      return (
        <g fill="currentColor">
          <rect x="1.5" y="1.5" width="3.9" height="3.9" rx=".5" /><rect x="6.05" y="1.5" width="3.9" height="3.9" rx=".5" />
          <rect x="10.6" y="1.5" width="3.9" height="3.9" rx=".5" /><rect x="10.6" y="6.05" width="3.9" height="3.9" rx=".5" />
          <g opacity=".55">
            <rect x="6.05" y="6.05" width="3.9" height="3.9" rx=".5" /><rect x="1.5" y="10.6" width="3.9" height="3.9" rx=".5" />
            <rect x="6.05" y="10.6" width="3.9" height="3.9" rx=".5" /><rect x="10.6" y="10.6" width="3.9" height="3.9" rx=".5" />
          </g>
        </g>
      );
    case "git": return <GitMark />;
    case "vite": return <path fill="currentColor" d="M9.6.9 3.2 9.1h4.1L6.4 15.1l6.4-8.4H8.6Z" />;
    case "markdown":
      return <Stroke><rect x="1" y="3.5" width="14" height="9" rx="1.75" /><path d="M3.75 10V6l1.75 2.1L7.25 6v4M11 6v3.9M9.6 8.6 11 10l1.4-1.4" /></Stroke>;
    case "json":
      return <Stroke><path d="M5.5 2.5H5a1.5 1.5 0 0 0-1.5 1.5v2.25c0 .9-.65 1.75-1.5 1.75.85 0 1.5.85 1.5 1.75V12A1.5 1.5 0 0 0 5 13.5h.5M10.5 2.5h.5a1.5 1.5 0 0 1 1.5 1.5v2.25c0 .9.65 1.75 1.5 1.75-.85 0-1.5.85-1.5 1.75V12a1.5 1.5 0 0 1-1.5 1.5h-.5" /></Stroke>;
    case "react":
      return (
        <Stroke>
          <ellipse cx="8" cy="8" rx="6.5" ry="2.5" />
          <ellipse cx="8" cy="8" rx="6.5" ry="2.5" transform="rotate(60 8 8)" />
          <ellipse cx="8" cy="8" rx="6.5" ry="2.5" transform="rotate(120 8 8)" />
          <circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none" />
        </Stroke>
      );
    case "css": return <Stroke><path d="M6.25 2.25 4.75 13.75M11.25 2.25l-1.5 11.5M2.75 5.75h10.75M2.25 10.25H13" /></Stroke>;
    case "html": return <Stroke><path d="m5 4.5-3.5 3.5L5 11.5M11 4.5l3.5 3.5-3.5 3.5M9.25 2.75l-2.5 10.5" /></Stroke>;
    case "code": return <Stroke><path d={PAGE} /><path d={FOLD} /><path d="m6.6 8.1-1.5 1.65 1.5 1.65M9.4 8.1l1.5 1.65-1.5 1.65" /></Stroke>;
    case "shell": return <Stroke><rect x="1.25" y="2.5" width="13.5" height="11" rx="2" /><path d="m4.25 6.25 2 1.75-2 1.75M8 10.25h3.5" /></Stroke>;
    case "config": return <Stroke><path d="M2.5 4h6M11.5 4h2M2.5 8h2M7.5 8h6M2.5 12h7M12.5 12h1" /><circle cx="10" cy="4" r="1.5" /><circle cx="6" cy="8" r="1.5" /><circle cx="11" cy="12" r="1.5" /></Stroke>;
    case "lock": return <Stroke><rect x="3" y="7" width="10" height="7.25" rx="1.5" /><path d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2" /></Stroke>;
    case "agents": return <Stroke><circle cx="8" cy="8" r="6.5" /><path d="m5.25 6 2 2-2 2M8.75 10.25h2.25" /></Stroke>;
    case "image": return <Stroke><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.75" /><circle cx="5.5" cy="6.25" r="1.1" /><path d="m14.25 10.5-3.25-3.25-6.75 6" /></Stroke>;
    case "pdf": return <Stroke><path d={PAGE} /><path d={FOLD} /><path d="M5.75 8.5h4.5M5.75 11h3" /></Stroke>;
    case "text": return <Stroke><path d={PAGE} /><path d={FOLD} /><path d="M5.75 8h4.5M5.75 10.25h4.5M5.75 12.5h2.5" /></Stroke>;
    case "database": return <Stroke><ellipse cx="8" cy="3.75" rx="5.25" ry="2" /><path d="M2.75 3.75v8.5c0 1.1 2.35 2 5.25 2s5.25-.9 5.25-2v-8.5M2.75 8c0 1.1 2.35 2 5.25 2s5.25-.9 5.25-2" /></Stroke>;
    case "container": return <Stroke><path d="M8 1.75 14 5v6L8 14.25 2 11V5Z" /><path d="M2 5l6 3.25L14 5M8 8.25v6" /></Stroke>;
    case "file": return <Stroke><path d={PAGE} /><path d={FOLD} /></Stroke>;
  }
}

/** The tree's mark for a file: its tool's or language's glyph, in that kind's theme colour. */
export const FileTypeIcon = memo(function FileTypeIcon({ name, size = 14 }: { name: string; size?: number }) {
  const kind = fileKind(name.slice(name.lastIndexOf("/") + 1));
  return (
    <span className="panel-tree-icon file-type-icon" data-file-icon={kind.icon} style={{ color: `var(${kind.tone})` }} aria-hidden>
      <svg width={size} height={size} viewBox="0 0 16 16"><Glyph icon={kind.icon} /></svg>
    </span>
  );
});
