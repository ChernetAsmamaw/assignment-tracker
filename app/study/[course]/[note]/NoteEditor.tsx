"use client";

import { Extension } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";

export interface NoteEditorHandle {
  focus(where?: "start" | "end"): void;
}

// The page you write on: headings, lists, to-dos, tables, quotes and code, written the way you'd
// write Markdown (# for a heading, - for a list, [ ] for a to-do) or pasted from anywhere. It's
// kept as Markdown, so Copy as Markdown and the class notes read it as written.
export default function NoteEditor({ value, onChange, focus, handle, onReady }: {
  value: string;
  onChange: (markdown: string) => void;
  focus: boolean;
  handle: React.RefObject<NoteEditorHandle | null>;
  onReady: () => void;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: true, autolink: true, defaultProtocol: "https" } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder: "Start writing…" }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
      PasteMarkdown,
    ],
    content: value,
    contentType: "markdown",
    editorProps: { attributes: { class: "note-md", role: "textbox", "aria-multiline": "true", "aria-label": "Your notes" } },
    onUpdate: ({ editor }) => onChange(editor.getMarkdown()),
    onCreate: onReady,
  });

  useEffect(() => {
    handle.current = editor ? { focus: (where = "end") => void editor.commands.focus(where) } : null;
    return () => void (handle.current = null);
  }, [editor, handle]);

  useEffect(() => {
    if (focus) editor?.commands.focus("end");
  }, [editor, focus]);

  return <EditorContent editor={editor} />;
}

// Pasting Markdown (from a .md file, a code editor or a chat) gives headings, lists and tables, not
// the # and - it's written with. Copied web pages, docs and chats that come with their formatting
// keep it the usual way.
const PasteMarkdown = Extension.create({
  name: "pasteMarkdown",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("pasteMarkdown"),
        props: {
          handlePaste: (_view, event) => {
            const text = event.clipboardData?.getData("text/plain") ?? "";
            const html = event.clipboardData?.getData("text/html") ?? "";
            if (!looksLikeMarkdown(text) || formatted(html) || editor.isActive("codeBlock")) return false;
            return editor.commands.insertContent(text.replace(/\r\n?/g, "\n"), { contentType: "markdown" });
          },
        },
      }),
    ];
  },
});

const MARKDOWN = [
  /^ {0,3}#{1,6}[ \t]+\S/m, // # a heading
  /^ {0,3}[-*+][ \t]+\S/m, // - a list
  /^ {0,3}\d{1,3}[.)][ \t]+\S/m, // 1. a numbered list
  /^ {0,3}>[ \t]?\S/m, // > a quote
  /^ {0,3}(```|~~~)/m, // ``` code
  /^ {0,3}\|?.+\|.+\n {0,3}\|? *:?-{3,}/m, // a table
  /\*\*\S(?:.*?\S)?\*\*|__\S(?:.*?\S)?__/, // **bold**
  /\[[^\]\n]+\]\([^)\s]+\)/, // [a link](url)
  /(^|\s)`[^`\n]+`/, // `code`
  /~~\S(?:.*?\S)?~~/, // ~~struck~~
];
const looksLikeMarkdown = (text: string) => MARKDOWN.some((r) => r.test(text));

// HTML that carries real formatting. Code editors and some apps send their text wrapped in HTML
// that's only colors and line breaks; for those, the Markdown in the text is what counts.
const formatted = (html: string) => /<(h[1-6]|ul|ol|li|table|blockquote|pre|strong|em|code|hr|a\s+[^>]*href)\b/i.test(html);
