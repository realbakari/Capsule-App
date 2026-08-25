import { Fragment, type ReactNode } from "react";

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
      return (
        <a key={index} href={link[2]} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function block(text: string, key: number): ReactNode {
  const lines = text.split("\n");
  return lines.map((line, index) => {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading?.[1] && heading[2]) {
      const Tag = heading[1].length === 1 ? "h3" : "h4";
      return (
        <Tag key={`${key}-${index}`} className="md-h">
          {inline(heading[2])}
        </Tag>
      );
    }
    if (/^\s*[-*]\s+/.test(line)) {
      return (
        <div key={`${key}-${index}`} className="md-li">
          {inline(line.replace(/^\s*[-*]\s+/, ""))}
        </div>
      );
    }
    return (
      <Fragment key={`${key}-${index}`}>
        {inline(line)}
        {index < lines.length - 1 ? "\n" : null}
      </Fragment>
    );
  });
}

export function MessageBody({ content }: { content: string }) {
  const chunks = content.split(/```(?:\w+)?\n?/);
  return (
    <div className="body">
      {chunks.map((chunk, index) =>
        index % 2 === 1 ? (
          <pre className="msg-code mono" key={index}>
            {chunk.replace(/\n$/, "")}
          </pre>
        ) : (
          <Fragment key={index}>{block(chunk, index)}</Fragment>
        ),
      )}
    </div>
  );
}
