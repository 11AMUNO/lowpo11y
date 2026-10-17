import { Fragment } from "react";
import { CopyButton } from "@/features/catalog/download-panel";

/**
 * Line-numbered code with comments dimmed. Monochrome on purpose: the site
 * has one accent, and comments are the only thing worth separating.
 */
function highlight(code: string) {
  let inBlock = false;
  return code.split("\n").map((line) => {
    const parts: { text: string; comment: boolean }[] = [];
    let rest = line;
    while (rest) {
      if (inBlock) {
        const end = rest.indexOf("*/");
        if (end < 0) {
          parts.push({ text: rest, comment: true });
          rest = "";
        } else {
          parts.push({ text: rest.slice(0, end + 2), comment: true });
          rest = rest.slice(end + 2);
          inBlock = false;
        }
        continue;
      }
      const line_ = rest.indexOf("//");
      const block = rest.indexOf("/*");
      const at = [line_, block].filter((i) => i >= 0).sort((a, b) => a - b)[0];
      if (at === undefined) {
        parts.push({ text: rest, comment: false });
        rest = "";
      } else {
        if (at > 0) parts.push({ text: rest.slice(0, at), comment: false });
        if (at === line_) {
          parts.push({ text: rest.slice(at), comment: true });
          rest = "";
        } else {
          rest = rest.slice(at);
          inBlock = true;
        }
      }
    }
    return parts;
  });
}

export function CodeBlock({ code, filename, language }: { code: string; filename: string; language: string }) {
  const lines = highlight(code.replace(/\n$/, ""));
  const width = String(lines.length).length;
  return (
    <section aria-labelledby="code-title" className="border border-rule-strong bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule-strong px-3.5 py-2">
        <h2 id="code-title" className="type-panel">
          // {filename}
        </h2>
        <div className="flex items-center gap-3">
          <span className="font-ocr text-[11px] tracking-[0.06em] text-muted uppercase">
            {language} // {lines.length} lines
          </span>
          <CopyButton text={code} label="Copy code" />
        </div>
      </div>
      <pre tabIndex={0} aria-label={`${filename}, ${lines.length} lines`} className="lp-scroll max-h-[34rem] overflow-auto bg-sunken py-3 font-mono text-[12.5px] leading-[1.55] outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--color-bright)]">
        <code className="grid grid-cols-[auto_1fr]">
          {lines.map((parts, i) => (
            <Fragment key={i}>
              <span aria-hidden className="pr-4 pl-3 text-right text-muted select-none" style={{ minWidth: `${width + 2}ch` }}>
                {i + 1}
              </span>
              <span className="pr-4 whitespace-pre text-fg">
                {parts.length ? parts.map((p, j) => (p.comment ? <span key={j} className="text-muted">{p.text}</span> : <Fragment key={j}>{p.text}</Fragment>)) : " "}
              </span>
            </Fragment>
          ))}
        </code>
      </pre>
    </section>
  );
}
