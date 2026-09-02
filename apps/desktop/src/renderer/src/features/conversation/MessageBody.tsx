import { Fragment, useState, type ReactNode } from "react";
import { CopyIcon } from "../shell/icons";
import { highlight } from "../../lib/highlight";
import { splitFences } from "../../lib/fences";
import { parseTable } from "../../lib/tables";
import { useWorkspace } from "../../lib/workspace";

/**
 * Heuristic: does the text inside backticks look like a file path?
 * Must have a recognised extension OR contain a `/` that isn't a URL or flag.
 */
const FILE_EXT_RE =
  /\.(ts|tsx|js|jsx|json|css|html|md|py|rs|go|yml|yaml|toml|sh|mjs|cjs|sql|svg|txt)$/i;

function isFilePath(value: string): boolean {
  if (value.length < 3 || value.length > 120) return false;
  if (value.includes(" ") || value.includes("\n")) return false;
  if (value.startsWith("-") || value.startsWith("http")) return false;
  if (FILE_EXT_RE.test(value)) return true;
  return value.includes("/") && /\w/.test(value[0] ?? "");
}

function inline(
  text: string,
  onOpenFile?: (path: string) => void,
  onOpenLink?: (href: string) => void,
): ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      const inner = part.slice(1, -1);
      // File paths: render as inline code that is clickable (cursor changes on
      // hover) — no icon, no border, no button chrome.
      if (isFilePath(inner) && onOpenFile) {
        return (
          <code
            key={index}
            className="file-mention"
            role="button"
            tabIndex={0}
            onClick={() => onOpenFile(inner)}
            onKeyDown={(e) => { if (e.key === "Enter") onOpenFile(inner); }}
            title={inner}
          >
            {inner}
          </code>
        );
      }
      return <code key={index}>{inner}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link?.[1] && link[2]) {
      const href = link[2];
      return (
        <a
          key={index}
          href={href}
          onClick={(event) => {
            event.preventDefault();
            if (onOpenLink) onOpenLink(href);
            else window.open(href, "_blank", "noopener");
          }}
        >
          {link[1]}
        </a>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function block(
  text: string,
  key: number,
  onOpenFile?: (path: string) => void,
  onOpenLink?: (href: string) => void,
): ReactNode {
  const lines = text.split("\n");
  const out: ReactNode[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    const table = parseTable(lines, index);
    if (table) {
      out.push(
        <div className="md-table-wrap" key={`${key}-${index}-table`}>
          <table className="md-table">
            <thead>
              <tr>
                {table.table.headers.map((header, column) => (
                  <th key={column} style={{ textAlign: table.table.align[column] ?? "left" }}>
                    {inline(header, onOpenFile, onOpenLink)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, column) => (
                    <td key={column} style={{ textAlign: table.table.align[column] ?? "left" }}>
                      {inline(cell, onOpenFile, onOpenLink)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      index += table.consumed - 1;
      continue;
    }

    // Headings
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading?.[1] && heading[2]) {
      const Tag = heading[1].length === 1 ? "h3" : "h4";
      out.push(
        <Tag key={`${key}-${index}`} className="md-h">
          {inline(heading[2], onOpenFile, onOpenLink)}
        </Tag>,
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      out.push(
        <div key={`${key}-${index}`} className="md-li">
          {inline(line.replace(/^\s*[-*]\s+/, ""), onOpenFile, onOpenLink)}
        </div>,
      );
      continue;
    }

    // Ordered list
    const num = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (num?.[1] && num[2]) {
      out.push(
        <div key={`${key}-${index}`} className="md-li-num">
          <span className="md-num">{num[1]}.</span>
          <span>{inline(num[2], onOpenFile, onOpenLink)}</span>
        </div>,
      );
      continue;
    }

    // Plain prose
    out.push(
      <Fragment key={`${key}-${index}`}>{inline(line, onOpenFile, onOpenLink)}</Fragment>,
    );
    if (index < lines.length - 1) out.push(<Fragment key={`${key}-${index}-nl`}>{"\n"}</Fragment>);
  }
  return out;
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="msg-code-wrap">
      <div className="msg-code-bar">
        <span className="msg-code-lang">{language || "code"}</span>
        <button
          className="icon-btn"
          title="Copy code"
          aria-label="Copy code"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1_200);
            });
          }}
        >
          {copied ? "Copied" : <CopyIcon size={13} />}
        </button>
      </div>
      <pre className="msg-code mono">{highlight(code, language)}</pre>
    </div>
  );
}

export function MessageBody({ content }: { content: string }) {
  const { openFile, setBrowserUrl, setInspectorOpen, setInspectorTab } = useWorkspace();

  /*
   * The path, not the folder it is in. This opened the file tree and stopped
   * there, so clicking a file the agent had just named left you to find it by
   * hand in a tree that was not even scrolled to it.
   */
  function handleOpenFile(path: string) {
    openFile(path);
  }

  function handleOpenLink(href: string) {
    if (/^https?:\/\//i.test(href)) {
      setBrowserUrl(href);
      setInspectorTab("browser");
      setInspectorOpen(true);
      return;
    }
    window.open(href, "_blank", "noopener");
  }

  return (
    <div className="body">
      {splitFences(content).map((segment, index) =>
        segment.kind === "code" ? (
          <CodeBlock key={index} code={segment.text} language={segment.language} />
        ) : (
          <Fragment key={index}>
            {block(segment.text, index, handleOpenFile, handleOpenLink)}
          </Fragment>
        ),
      )}
    </div>
  );
}
