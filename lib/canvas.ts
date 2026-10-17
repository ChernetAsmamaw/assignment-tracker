import sanitizeHtml from "sanitize-html";
import type { Assignment } from "./types";

const BASE = (process.env.CANVAS_BASE_URL || "https://q.utoronto.ca").replace(/\/$/, "");

// The gallery shows assignments due from two weeks ago onward; older ones only feed grade insights.
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
export const isRecent = (a: Assignment) => !a.dueAt || new Date(a.dueAt).getTime() >= Date.now() - LOOKBACK_MS;

export const isDemo = () => !process.env.CANVAS_TOKEN;

async function canvasGetAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = `${BASE}/api/v1${path}`;
  while (url) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.CANVAS_TOKEN}` },
      next: { revalidate: 300 },
    });
    if (!res.ok) throw new Error(`Quercus ${res.status} on ${path}: ${await res.text()}`);
    out.push(...((await res.json()) as T[]));
    const next = res.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return out;
}

interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
}

interface CanvasAssignment {
  id: number;
  name: string;
  due_at: string | null;
  html_url: string;
  points_possible: number | null;
  group_category_id?: number | null;
  description?: string | null;
  submission_types?: string[];
  allowed_attempts?: number | null;
  unlock_at?: string | null;
  lock_at?: string | null;
  grading_type?: string | null;
  published?: boolean;
  submission?: { workflow_state: string; submitted_at: string | null; score?: number | null; late?: boolean };
}

export async function getAssignments(): Promise<Assignment[]> {
  if (isDemo()) return demoAssignments();

  const courses = await canvasGetAll<CanvasCourse>(
    "/courses?enrollment_state=active&enrollment_type=student&per_page=100",
  );

  const perCourse = await Promise.all(
    courses.map(async (c) => {
      const list = await canvasGetAll<CanvasAssignment>(
        `/courses/${c.id}/assignments?include[]=submission&order_by=due_date&per_page=100`,
      ).catch(() => [] as CanvasAssignment[]); // some courses hide the assignments tab
      return list
        .filter((a) => a.published !== false)
        .map<Assignment>((a) => ({
          id: String(a.id),
          name: a.name,
          course: c.name,
          courseCode: c.course_code,
          dueAt: a.due_at,
          url: a.html_url,
          points: a.points_possible,
          submitted:
            !!a.submission?.submitted_at ||
            a.submission?.workflow_state === "graded",
          isGroup: a.group_category_id != null,
          description: a.description ? cleanHtml(a.description) : null,
          submissionTypes: a.submission_types ?? [],
          allowedAttempts: a.allowed_attempts != null && a.allowed_attempts > 0 ? a.allowed_attempts : null,
          unlockAt: a.unlock_at ?? null,
          lockAt: a.lock_at ?? null,
          gradingType: a.grading_type ?? null,
          score: a.submission?.workflow_state === "graded" && a.submission.score != null ? a.submission.score : null,
          late: !!a.submission?.late,
        }));
    }),
  );

  return sortByDue(perCourse.flat());
}

export async function getAssignment(id: string): Promise<Assignment | undefined> {
  return (await getAssignments()).find((a) => a.id === id);
}

// Instructor-written HTML: keep formatting, drop scripts/styles, make Quercus links absolute.
function cleanHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "span"]),
    allowedAttributes: { a: ["href", "title", "target", "rel"], img: ["src", "alt", "width", "height"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (tag, attribs) => ({
        tagName: "a",
        attribs: { ...attribs, href: absolute(attribs.href), target: "_blank", rel: "noreferrer" },
      }),
      img: (tag, attribs) => ({ tagName: "img", attribs: { ...attribs, src: absolute(attribs.src) } }),
    },
    allowedSchemesAppliedToAttributes: ["href", "src"],
  });
}

const absolute = (url = "") => (url.startsWith("/") ? `${BASE}${url}` : url);

function sortByDue(list: Assignment[]) {
  return list.sort((a, b) => {
    if (!a.dueAt) return 1;
    if (!b.dueAt) return -1;
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
  });
}

const demoDetails = {
  description:
    "<p>This is where the assignment instructions from Quercus appear.</p><ul><li>Answer all questions</li><li>Show your work</li></ul><p>See the <a href=\"https://q.utoronto.ca\" target=\"_blank\" rel=\"noreferrer\">course page</a> for the rubric.</p>",
  submissionTypes: ["online_upload"],
  allowedAttempts: null,
  unlockAt: null,
  lockAt: null,
  gradingType: "points",
  score: null,
  late: false,
};

const demoText: Record<string, string> = {
  d1: "<p>Complete questions 1 to 5 on heaps and AVL trees. For each algorithm, give pseudocode and a worst-case runtime proof.</p><ul><li>Typeset in LaTeX and submit a single PDF to MarkUs</li><li>Collaboration is allowed in pairs, but write up your own solutions</li></ul><p>See the <a href=\"https://www.cs.toronto.edu/~csc263/\">course notes on heaps</a>.</p>",
  d2: "<p>Write a lab report (max 6 pages) on the titration experiment from week 4. Include an abstract, methods, results with an error analysis, and a discussion comparing your value to the literature.</p><ul><li>One submission per group of 3</li><li>Use ACS citation style</li><li>Attach your raw data sheet as an appendix</li></ul>",
  d3: "<p>Submit a one-page outline for your final essay on <em>Frankenstein</em>. State your thesis, three supporting arguments with textual evidence, and at least two secondary sources.</p><p>MLA format. Late outlines lose 5% per day.</p>",
  d5: "<p>Propose a final project that applies a data structure from the course to a real problem. 2 pages: motivation, the data structure and why, an expected-complexity analysis, and a timeline with each member's role.</p>",
  d6: "<p>Prepare a two-page summary of limits, continuity and the derivative rules for the midterm. Optional, not graded.</p>",
  d4: "<p>Reflect on your Quiz 2 mistakes in 200 words.</p>",
};

function demoAssignments(): Assignment[] {
  const day = 24 * 60 * 60 * 1000;
  const at = (d: number) => new Date(Date.now() + d * day).toISOString();
  return sortByDue([
    { id: "d1", name: "Problem Set 3", course: "CSC263: Data Structures", courseCode: "CSC263", dueAt: at(1), url: "#", points: 20, submitted: false, isGroup: false, ...demoDetails, description: demoText.d1 },
    { id: "d2", name: "Lab Report 2", course: "CHM135: Chemistry", courseCode: "CHM135", dueAt: at(3), url: "#", points: 15, submitted: false, isGroup: true, ...demoDetails, description: demoText.d2 },
    { id: "d3", name: "Essay Outline", course: "ENG140: Literature", courseCode: "ENG140", dueAt: at(6), url: "#", points: 10, submitted: false, isGroup: false, ...demoDetails, description: demoText.d3 },
    { id: "d4", name: "Quiz 2 Reflection", course: "MAT137: Calculus", courseCode: "MAT137", dueAt: at(-2), url: "#", points: 5, submitted: true, isGroup: false, ...demoDetails, description: demoText.d4, score: 4 },
    { id: "d6", name: "Midterm Review Notes", course: "MAT137: Calculus", courseCode: "MAT137", dueAt: at(-1), url: "#", points: 0, submitted: false, isGroup: false, ...demoDetails, description: demoText.d6 },
    { id: "g1", name: "Problem Set 1", course: "CSC263: Data Structures", courseCode: "CSC263", dueAt: at(-24), url: "#", points: 20, submitted: true, isGroup: false, ...demoDetails, description: null, score: 17 },
    { id: "g2", name: "Problem Set 2", course: "CSC263: Data Structures", courseCode: "CSC263", dueAt: at(-10), url: "#", points: 20, submitted: true, isGroup: false, ...demoDetails, description: null, score: 13, late: true },
    { id: "g3", name: "Lab Report 1", course: "CHM135: Chemistry", courseCode: "CHM135", dueAt: at(-13), url: "#", points: 15, submitted: true, isGroup: true, ...demoDetails, description: null, score: 13.5 },
    { id: "g4", name: "Quiz 1", course: "MAT137: Calculus", courseCode: "MAT137", dueAt: at(-16), url: "#", points: 5, submitted: true, isGroup: false, ...demoDetails, description: null, score: 3 },
    { id: "g5", name: "Close Reading Response", course: "ENG140: Literature", courseCode: "ENG140", dueAt: at(-8), url: "#", points: 10, submitted: true, isGroup: false, ...demoDetails, description: null, score: 9 },
    { id: "d5", name: "Final Project Proposal", course: "CSC263: Data Structures", courseCode: "CSC263", dueAt: at(12), url: "#", points: 30, submitted: false, isGroup: true, ...demoDetails, description: demoText.d5 },
  ]);
}
