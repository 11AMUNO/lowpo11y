import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders basic markdown", () => {
    expect(renderMarkdown("**Bold** and `code`\n\n- one\n- two")).toBe("<p><strong>Bold</strong> and <code>code</code></p>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n");
  });
  it("strips scripts, event handlers and javascript: links", () => {
    const out = renderMarkdown('<script>alert(1)</script><img src=x onerror=alert(1)> [x](javascript:alert(1)) <a href="https://ok.example">ok</a>');
    expect(out).not.toMatch(/<script|onerror=|href="javascript:|<img/i);
    expect(renderMarkdown('<a href="javascript:alert(1)">x</a>')).not.toMatch(/href=/);
  });
  it("adds safe rel/target to links", () => {
    expect(renderMarkdown("[docs](https://example.com)")).toContain('rel="nofollow noopener noreferrer"');
  });
  it("returns empty for blank input", () => expect(renderMarkdown("   ")).toBe(""));
});
