import { Fragment, useState, type ReactNode } from "react";
import { CopyIcon } from "../shell/icons";
import { highlight } from "../../lib/highlight";
import { splitFences } from "../../lib/fences";
import { parseTable } from "../../lib/tables";

function inline(text: string): ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return <code key={index}>{part.slice(1, -1)}</code>;
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
            window.open(href, "_blank", "noopener");
          }}
        >
          {link[1]}
        </a>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function block(text: string, key: number): ReactNode {
  const lines = text.split("\n");
  const out: ReactNode[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    // Tables first: their rows would otherwise each be read as prose and
    // rendered as a line of pipes.
    const table = parseTable(lines, index);
    if (table) {
      out.push(
        <div className="md-table-wrap" key={`${key}-${index}-table`}>
          <table className="md-table">
            <thead>
              <tr>
                {table.table.headers.map((header, column) => (
                  <th key={column} style={{ textAlign: table.table.align[column] ?? "left" }}>
                    {inline(header)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, column) => (
                    <td key={column} style={{ textAlign: table.table.align[column] ?? "left" }}>
                      {inline(cell)}
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

    out.push(<Fragment key={`${key}-${index}`}>{lineNode(line, `${key}-${index}`)}</Fragment>);
    if (index < lines.length - 1) out.push(<Fragment key={`${key}-${index}-nl`}>{"\n"}</Fragment>);
  }
  return out;
}

function lineNode(line: string, key: string): ReactNode {
  return [line].map((value, index) => {
    void index;
    const heading = /^(#{1,3})\s+(.*)$/.exec(value);
    if (heading?.[1] && heading[2]) {
      const Tag = heading[1].length === 1 ? "h3" : "h4";
      return (
        <Tag key={key} className="md-h">
          {inline(heading[2])}
        </Tag>
      );
    }
    if (/^\s*[-*]\s+/.test(value)) {
      return (
        <div key={key} className="md-li">
          {inline(value.replace(/^\s*[-*]\s+/, ""))}
        </div>
      );
    }
    return <Fragment key={key}>{inline(value)}</Fragment>;
  });
}

/*
 * Capturing the fence language splits the content into a repeating triple:
 * prose, language, code. Keeping the language lets the block label itself, and
 * a fenced block is the one thing in a reply people most often want to lift
 * out — so it gets its own copy control rather than only the whole-message one.
 */
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
  return (
    <div className="body">
      {splitFences(content).map((segment, index) =>
        segment.kind === "code" ? (
          <CodeBlock key={index} code={segment.text} language={segment.language} />
        ) : (
          <Fragment key={index}>{block(segment.text, index)}</Fragment>
        ),
      )}
    </div>
  );
}
