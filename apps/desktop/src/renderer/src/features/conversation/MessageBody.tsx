import { Fragment, type ReactNode } from "react";

function inline(text: string): ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

export function MessageBody({ content }: { content: string }) {
  const chunks = content.split(/```(?:\w+)?\n?/);
  if (chunks.length === 1) {
    return <div className="body">{inline(content)}</div>;
  }
  return (
    <div className="body">
      {chunks.map((chunk, index) =>
        index % 2 === 1 ? (
          <pre className="msg-code mono" key={index}>
            {chunk.replace(/\n$/, "")}
          </pre>
        ) : (
          <Fragment key={index}>{inline(chunk)}</Fragment>
        ),
      )}
    </div>
  );
}
