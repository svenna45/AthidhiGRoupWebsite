export const DiffView = ({ lines, path }) => {
  if (!lines) return <p className="text-xs text-muted-foreground p-3 font-mono">No text diff available (binary, unchanged or too large).</p>;
  let a = 0, b = 0;
  return (
    <pre className="text-[11.5px] leading-5 overflow-auto max-h-80 bg-[#0B0E14] rounded-b-md" data-testid={`diff-${path}`}>
      {lines.map((l, i) => {
        if (l.startsWith("@@")) {
          const m = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l);
          if (m) { a = +m[1]; b = +m[2]; }
          return <div key={i} className="diff-hunk px-3">{l}</div>;
        }
        if (l.startsWith("---") || l.startsWith("+++")) return <div key={i} className="px-3 text-muted-foreground">{l}</div>;
        const type = l[0] === "+" ? "add" : l[0] === "-" ? "del" : "ctx";
        const la = type === "add" ? "" : a++;
        const lb = type === "del" ? "" : b++;
        return (
          <div key={i} className={`flex ${type === "add" ? "diff-add" : type === "del" ? "diff-del" : ""}`}>
            <span className="w-10 shrink-0 text-right pr-2 text-muted-foreground/60 select-none">{la}</span>
            <span className="w-10 shrink-0 text-right pr-2 text-muted-foreground/60 select-none">{lb}</span>
            <span className="whitespace-pre flex-1 pr-3">{l}</span>
          </div>
        );
      })}
    </pre>
  );
};
