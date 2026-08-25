export function DiffView({ text }: { text: string }) {
  if (!text.trim()) return <div className="faint">No diff.</div>;
  return (
    <pre className="diff-view mono">
      {text.split(/\n/).map((line, index) => {
        const kind = line.startsWith("+++") || line.startsWith("---")
          ? "file"
          : line.startsWith("+")
            ? "add"
            : line.startsWith("-")
              ? "del"
              : line.startsWith("@@")
                ? "hunk"
                : "ctx";
        return (
          <div className={`diff-line ${kind}`} key={`${index}-${line.slice(0, 24)}`}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}
