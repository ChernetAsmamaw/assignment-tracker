"use client";

import type { LectureNotes, NotePoint, SourcedLine } from "@/lib/lectures";

type Line = (key: string, l: SourcedLine, tag?: React.ReactNode) => React.ReactNode;

// Notes from a class recording, laid out to study from: the gist, the takeaways, what to do, the
// content by topic, key terms, and questions to test yourself. `line` draws a line whose source
// shows on hover; its keys match allLines below.
export function ClassNotes({ notes, line, checked, onCheck }: { notes: LectureNotes; line: Line; checked: Set<string>; onCheck: (text: string) => void }) {
  const point = (key: string, p: NotePoint) => (
    <>
      {line(key, p, p.exam && <span className="exam-tag" title="The lecturer said this is on a test, or stressed it">Exam</span>)}
      {!!p.sub?.length && <ul>{p.sub.map((c, ci) => <li key={ci}>{line(`${key}-${ci}`, c)}</li>)}</ul>}
    </>
  );
  const takeaways = notes.takeaways ?? [];
  const questions = notes.questions ?? [];
  return (
    <>
      {notes.summary.length > 0 && (
        <div className="callout">
          <span className="callout-ico" aria-hidden>💡</span>
          <div>
            <div className="callout-label">In short</div>
            <p className="doc-summary">{notes.summary.map((l, i) => <span key={i}>{line(`sum${i}`, l)} </span>)}</p>
          </div>
        </div>
      )}

      {takeaways.length > 0 && (
        <>
          <h2>Key takeaways</h2>
          <ol className="takeaways">{takeaways.map((p, i) => <li key={i}>{point(`take${i}`, p)}</li>)}</ol>
        </>
      )}

      {notes.actions.length > 0 && (
        <>
          <h2>To do</h2>
          {notes.actions.map((l, i) => (
            <div key={i} className={`todo ${checked.has(l.text) ? "done" : ""}`}>
              <input type="checkbox" checked={checked.has(l.text)} onChange={() => onCheck(l.text)} aria-label="Done" />
              {line(`act${i}`, l)}
            </div>
          ))}
        </>
      )}

      {notes.sections.map((sec, si) => (
        <section key={si}>
          <h2>{inline(sec.heading)}</h2>
          <ul>{sec.bullets.map((b, bi) => <li key={bi}>{point(`sec${si}-${bi}`, b)}</li>)}</ul>
        </section>
      ))}

      {notes.terms.length > 0 && (
        <>
          <h2>Key terms</h2>
          <table className="doc-table">
            <thead><tr><th>Term</th><th>What it means</th></tr></thead>
            <tbody>
              {notes.terms.map((t, i) => (
                <tr key={i}>
                  <td>{inline(t.term)}</td>
                  <td>{line(`term${i}`, { text: t.definition, sources: t.sources })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {questions.length > 0 && (
        <>
          <h2>Check yourself</h2>
          <div className="quiz">
            {questions.map((q, i) => (
              <details key={i}>
                <summary>{inline(q.question)}</summary>
                <div className="quiz-a">{line(`q${i}`, { text: q.answer, sources: q.sources })}</div>
              </details>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// **bold** and `code` in a line of the notes. Everything else stays plain text.
export function inline(text: string): React.ReactNode {
  const bits = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g);
  if (bits.length === 1) return text;
  return bits.map((b, i) =>
    b.length > 4 && b.startsWith("**") && b.endsWith("**") ? <strong key={i}>{b.slice(2, -2)}</strong> : b.length > 2 && b.startsWith("`") && b.endsWith("`") ? <code key={i}>{b.slice(1, -1)}</code> : b,
  );
}

// Every line with a source, under the key ClassNotes gives it.
export function allLines(notes: LectureNotes | null): { key: string; sources: string[] }[] {
  if (!notes) return [];
  const points = (prefix: string, list: NotePoint[]) =>
    list.flatMap((p, i) => [{ key: `${prefix}${i}`, sources: p.sources }, ...(p.sub ?? []).map((c, ci) => ({ key: `${prefix}${i}-${ci}`, sources: c.sources }))]);
  return [
    ...notes.summary.map((l, i) => ({ key: `sum${i}`, sources: l.sources })),
    ...points("take", notes.takeaways ?? []),
    ...notes.actions.map((l, i) => ({ key: `act${i}`, sources: l.sources })),
    ...notes.sections.flatMap((s, si) => points(`sec${si}-`, s.bullets)),
    ...notes.terms.map((t, i) => ({ key: `term${i}`, sources: t.sources })),
    ...(notes.questions ?? []).map((q, i) => ({ key: `q${i}`, sources: q.sources })),
  ];
}
