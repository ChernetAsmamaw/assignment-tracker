import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";

// Your notes as HTML, drawn by the server so the note opens with them in place; the editor takes
// over once it has loaded. Read the same way the editor reads them, with anything that could run
// or load something taken out.
const marked = new Marked({ gfm: true, breaks: true });

export function notesHtml(markdown: string): string {
  if (!markdown.trim()) return "";
  return sanitizeHtml(marked.parse(markdown, { async: false }), {
    allowedTags: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "ul", "ol", "li", "strong", "b", "em", "i", "del", "s", "u", "code", "pre", "blockquote", "hr", "a", "table", "thead", "tbody", "tr", "th", "td", "input"],
    allowedAttributes: { a: ["href", "target", "rel"], ol: ["start"], input: ["type", "checked", "tabindex"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (_tag, attribs) => ({ tagName: "a", attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" } }),
      input: (_tag, attribs) => ({ tagName: "input", attribs: { type: "checkbox", tabindex: "-1", ...(attribs.checked != null ? { checked: "" } : {}) } }),
    },
  });
}
