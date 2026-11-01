"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LectureNotes, NotePoint, SourcedLine } from "@/lib/lectures";

// The class notes as text you can change, laid out like the notes themselves. Every line can be
// rewritten or cleared, and you can add your own anywhere. Gemini's lines keep their transcript
// sources; the lines you add have none. Enter starts a new line after the one you're in, and
// Backspace in an empty line removes it.

interface Line {
  key: number;
  text: string;
  sources: string[];
  exam?: boolean;
  sub?: Line[];
  was?: string; // the text it had before editing, to keep a ticked to-do ticked
}
interface Section {
  key: number;
  heading: string;
  bullets: Line[];
}
interface Pair {
  key: number;
  a: string; // a term, or a question
  b: string; // what it means, or the answer
  sources: string[];
}
interface Draft {
  summary: Line[];
  takeaways: Line[];
  actions: Line[];
  sections: Section[];
  terms: Pair[];
  questions: Pair[];
}

let last = 0;
const key = () => ++last;
const toLine = (l: SourcedLine & Partial<NotePoint>): Line => ({ key: key(), text: l.text, sources: l.sources, exam: l.exam, sub: l.sub?.map(toLine), was: l.text });
const blank = (): Line => ({ key: key(), text: "", sources: [] });

function toDraft(n: LectureNotes): Draft {
  return {
    summary: n.summary.map(toLine),
    takeaways: (n.takeaways ?? []).map(toLine),
    actions: n.actions.map(toLine),
    sections: n.sections.map((s) => ({ key: key(), heading: s.heading, bullets: s.bullets.map(toLine) })),
    terms: n.terms.map((t) => ({ key: key(), a: t.term, b: t.definition, sources: t.sources })),
    questions: (n.questions ?? []).map((q) => ({ key: key(), a: q.question, b: q.answer, sources: q.sources })),
  };
}

// The notes to save: empty lines and sections are left out.
function toNotes(d: Draft, base: LectureNotes): LectureNotes {
  const line = (x: Line): SourcedLine[] => (x.text.trim() ? [{ text: x.text.trim(), sources: x.sources }] : []);
  const point = (x: Line): NotePoint[] => {
    if (!x.text.trim()) return [];
    const sub = (x.sub ?? []).flatMap(line);
    return [{ text: x.text.trim(), sources: x.sources, ...(x.exam ? { exam: true } : {}), ...(sub.length ? { sub } : {}) }];
  };
  return {
    ...base,
    summary: d.summary.flatMap(line),
    takeaways: d.takeaways.flatMap(point),
    actions: d.actions.flatMap(line),
    sections: d.sections.map((s) => ({ heading: s.heading.trim() || "Notes", bullets: s.bullets.flatMap(point) })).filter((s) => s.bullets.length),
    terms: d.terms.flatMap((t) => (t.a.trim() ? [{ term: t.a.trim(), definition: t.b.trim(), sources: t.sources }] : [])),
    questions: d.questions.flatMap((q) => (q.a.trim() ? [{ question: q.a.trim(), answer: q.b.trim(), sources: q.sources }] : [])),
    edited: true,
  };
}

export function EditNotes({ notes, checked, onChange }: { notes: LectureNotes; checked: string[]; onChange: (notes: LectureNotes, checked: string[]) => void }) {
  const [d, setD] = useState(() => toDraft(notes));
  const [focus, setFocus] = useState<number | null>(null); // the line to put the cursor in
  const [start] = useState({ notes, checked });

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    const next = { ...d, [k]: v };
    setD(next);
    // A ticked to-do stays ticked when you reword it.
    const before = new Set(start.notes.actions.map((a) => a.text));
    const kept = start.checked.filter((t) => !before.has(t));
    const ticked = next.actions.filter((a) => a.was && start.checked.includes(a.was) && a.text.trim()).map((a) => a.text.trim());
    onChange(toNotes(next, start.notes), [...kept, ...ticked]);
  };
  const add = <K extends "summary" | "takeaways" | "actions">(k: K) => {
    const n = blank();
    set(k, [...d[k], n]);
    setFocus(n.key);
  };

  return (
    <div className="edit-notes">
      <div className="callout">
        <span className="callout-ico" aria-hidden>💡</span>
        <div>
          <div className="callout-label">In short</div>
          <ul className="edit-plain">
            <Lines items={d.summary} onChange={(v) => set("summary", v)} focus={focus} setFocus={setFocus} placeholder="A sentence of the summary" />
          </ul>
          <Add onClick={() => add("summary")}>Add to the summary</Add>
        </div>
      </div>

      <h2>Key takeaways</h2>
      <ol className="takeaways">
        <Lines items={d.takeaways} onChange={(v) => set("takeaways", v)} focus={focus} setFocus={setFocus} placeholder="An idea worth remembering" />
      </ol>
      <Add onClick={() => add("takeaways")}>Add a takeaway</Add>

      <h2>To do</h2>
      <ul className="edit-plain edit-todos">
        <Lines items={d.actions} onChange={(v) => set("actions", v)} focus={focus} setFocus={setFocus} placeholder="Something to do, with its date" />
      </ul>
      <Add onClick={() => add("actions")}>Add a to-do</Add>

      {d.sections.map((s, si) => {
        const change = (patch: Partial<Section>) => set("sections", d.sections.map((x, j) => (j === si ? { ...x, ...patch } : x)));
        return (
          <section key={s.key}>
            <h2>
              <Field
                value={s.heading}
                onChange={(heading) => change({ heading })}
                focus={focus === s.key}
                placeholder="Heading"
                onEnter={() => {
                  const n = blank();
                  change({ bullets: [n, ...s.bullets] });
                  setFocus(n.key);
                }}
                onEmpty={
                  s.bullets.some((b) => b.text.trim())
                    ? undefined
                    : () => {
                        set("sections", d.sections.filter((_, j) => j !== si));
                        setFocus(null);
                      }
                }
              />
            </h2>
            <ul>
              <Lines items={s.bullets} onChange={(bullets) => change({ bullets })} focus={focus} setFocus={setFocus} placeholder="A point" />
            </ul>
            <Add
              onClick={() => {
                const n = blank();
                change({ bullets: [...s.bullets, n] });
                setFocus(n.key);
              }}
            >
              Add a point
            </Add>
          </section>
        );
      })}
      <Add
        onClick={() => {
          const s = { key: key(), heading: "", bullets: [blank()] };
          set("sections", [...d.sections, s]);
          setFocus(s.key);
        }}
      >
        Add a section
      </Add>

      <h2>Key terms</h2>
      <Pairs items={d.terms} onChange={(v) => set("terms", v)} focus={focus} setFocus={setFocus} labels={["Term", "What it means"]} table />
      <Add
        onClick={() => {
          const t = { key: key(), a: "", b: "", sources: [] };
          set("terms", [...d.terms, t]);
          setFocus(t.key);
        }}
      >
        Add a term
      </Add>

      <h2>Check yourself</h2>
      <Pairs items={d.questions} onChange={(v) => set("questions", v)} focus={focus} setFocus={setFocus} labels={["A question to test yourself", "Its answer"]} />
      <Add
        onClick={() => {
          const q = { key: key(), a: "", b: "", sources: [] };
          set("questions", [...d.questions, q]);
          setFocus(q.key);
        }}
      >
        Add a question
      </Add>
    </div>
  );
}

// A list of lines, each with its points under it.
function Lines({ items, onChange, focus, setFocus, placeholder, nested = false }: {
  items: Line[];
  onChange: (items: Line[]) => void;
  focus: number | null;
  setFocus: (key: number | null) => void;
  placeholder: string;
  nested?: boolean;
}) {
  const change = (i: number, patch: Partial<Line>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <>
      {items.map((x, i) => (
        <li key={x.key}>
          <Field
            value={x.text}
            onChange={(text) => change(i, { text })}
            focus={focus === x.key}
            placeholder={nested ? "A detail" : placeholder}
            onEnter={() => {
              const n = blank();
              onChange([...items.slice(0, i + 1), n, ...items.slice(i + 1)]);
              setFocus(n.key);
            }}
            onEmpty={() => {
              onChange(items.filter((_, j) => j !== i));
              setFocus(items[i - 1]?.key ?? null);
            }}
          />
          {!!x.sub?.length && (
            <ul>
              <Lines items={x.sub} onChange={(sub) => change(i, { sub })} focus={focus} setFocus={setFocus} placeholder={placeholder} nested />
            </ul>
          )}
        </li>
      ))}
    </>
  );
}

// Terms and what they mean, or questions and their answers.
function Pairs({ items, onChange, focus, setFocus, labels, table = false }: {
  items: Pair[];
  onChange: (items: Pair[]) => void;
  focus: number | null;
  setFocus: (key: number | null) => void;
  labels: [string, string];
  table?: boolean;
}) {
  const change = (i: number, patch: Partial<Pair>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const remove = (i: number) => {
    onChange(items.filter((_, j) => j !== i));
    setFocus(null);
  };
  const fields = (x: Pair, i: number) => [
    <Field key="a" value={x.a} onChange={(a) => change(i, { a })} focus={focus === x.key} placeholder={labels[0]} onEmpty={x.b.trim() ? undefined : () => remove(i)} />,
    <Field key="b" value={x.b} onChange={(b) => change(i, { b })} placeholder={labels[1]} />,
  ];
  if (!items.length) return null;
  return table ? (
    <table className="doc-table edit-table">
      <tbody>
        {items.map((x, i) => {
          const [a, b] = fields(x, i);
          return (
            <tr key={x.key}>
              <td>{a}</td>
              <td>{b}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  ) : (
    <div className="quiz edit-quiz">
      {items.map((x, i) => {
        const [a, b] = fields(x, i);
        return (
          <div key={x.key} className="edit-q">
            {a}
            <div className="quiz-a">{b}</div>
          </div>
        );
      })}
    </div>
  );
}

// One line of text that grows to fit, styled like the notes around it.
function Field({ value, onChange, focus = false, placeholder, onEnter, onEmpty }: {
  value: string;
  onChange: (text: string) => void;
  focus?: boolean;
  placeholder: string;
  onEnter?: () => void;
  onEmpty?: () => void; // Backspace in the empty field
}) {
  const el = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const t = el.current;
    if (t) (t.style.height = "auto"), (t.style.height = `${t.scrollHeight}px`);
  }, [value]);
  useEffect(() => {
    const t = el.current;
    if (!focus || !t) return;
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  }, [focus]);
  return (
    <textarea
      ref={el}
      rows={1}
      className="edit-field"
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => onChange(e.target.value.replace(/\s*\n\s*/g, " "))}
      onKeyDown={(e) => {
        if (e.key === "Enter" && onEnter && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onEnter();
        } else if (e.key === "Backspace" && !value && onEmpty) {
          e.preventDefault();
          onEmpty();
        }
      }}
    />
  );
}

function Add({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="edit-add" onClick={onClick}>
      + {children}
    </button>
  );
}
