import sanitizeHtml from "sanitize-html";

// Just enough markdown for Granola summaries: headings, nested bullets, bold, italics, code and links.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])[*_]([^*_]+)[*_](?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
}

export function markdownToHtml(md: string): string {
  const out: string[] = [];
  const depth: number[] = []; // indent of each open <ul>
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const closeLists = (toIndent = -1) => {
    while (depth.length && depth[depth.length - 1] > toIndent) {
      out.push("</li></ul>");
      depth.pop();
    }
  };

  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const line = raw.replace(/\t/g, "  ");
    const bullet = line.match(/^(\s*)[-*+•]\s+(.*)$/) ?? line.match(/^(\s*)\d+[.)]\s+(.*)$/);
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (bullet) {
      flush();
      const indent = bullet[1].length;
      closeLists(indent);
      if (depth.length && depth[depth.length - 1] === indent) out.push("</li><li>");
      else {
        out.push("<ul><li>");
        depth.push(indent);
      }
      out.push(inline(bullet[2]));
    } else if (heading) {
      flush();
      closeLists();
      const level = Math.min(6, heading[1].length + 2); // h3 and below inside a page
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (!line.trim()) {
      flush();
      closeLists();
    } else if (depth.length) {
      out.push(` ${inline(line.trim())}`); // wrapped bullet text
    } else {
      para.push(line.trim());
    }
  }
  flush();
  closeLists();
  return sanitizeHtml(out.join(""), {
    allowedTags: ["p", "h3", "h4", "h5", "h6", "ul", "li", "strong", "em", "code", "a"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https"],
  });
}
