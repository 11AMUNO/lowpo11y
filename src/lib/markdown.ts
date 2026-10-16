import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";

/**
 * Markdown for CMS text (descriptions, usage notes). Raw HTML in the source is
 * escaped, and the rendered output is sanitised again with a strict allow-list.
 */
const marked = new Marked({ gfm: true, breaks: false });
marked.use({
  renderer: {
    html: ({ text }) => sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} }),
  },
});

const ALLOWED = {
  allowedTags: ["p", "br", "strong", "em", "code", "pre", "blockquote", "ul", "ol", "li", "h2", "h3", "h4", "a", "hr", "table", "thead", "tbody", "tr", "th", "td", "del"],
  allowedAttributes: { a: ["href", "title", "rel", "target"] },
  allowedSchemes: ["https", "http", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "nofollow noopener noreferrer", target: "_blank" }),
    h1: "h2",
  },
};

export function renderMarkdown(source: string): string {
  if (!source.trim()) return "";
  const html = marked.parse(source, { async: false }) as string;
  return sanitizeHtml(html, ALLOWED);
}
