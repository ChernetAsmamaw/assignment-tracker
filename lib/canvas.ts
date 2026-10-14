import type { Assignment } from "./types";

const BASE = (process.env.CANVAS_BASE_URL || "https://q.utoronto.ca").replace(/\/$/, "");

// Show assignments due from two weeks ago onward, so recently missed ones stay visible.
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

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
  published?: boolean;
  submission?: { workflow_state: string; submitted_at: string | null };
}

export async function getAssignments(): Promise<Assignment[]> {
  if (isDemo()) return demoAssignments();

  const courses = await canvasGetAll<CanvasCourse>(
    "/courses?enrollment_state=active&enrollment_type=student&per_page=100",
  );
  const cutoff = Date.now() - LOOKBACK_MS;

  const perCourse = await Promise.all(
    courses.map(async (c) => {
      const list = await canvasGetAll<CanvasAssignment>(
        `/courses/${c.id}/assignments?include[]=submission&order_by=due_date&per_page=100`,
      ).catch(() => [] as CanvasAssignment[]); // some courses hide the assignments tab
      return list
        .filter((a) => a.published !== false)
        .filter((a) => !a.due_at || new Date(a.due_at).getTime() >= cutoff)
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
        }));
    }),
  );

  return sortByDue(perCourse.flat());
}

export async function getAssignment(id: string): Promise<Assignment | undefined> {
  return (await getAssignments()).find((a) => a.id === id);
}

function sortByDue(list: Assignment[]) {
  return list.sort((a, b) => {
    if (!a.dueAt) return 1;
    if (!b.dueAt) return -1;
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
  });
}

function demoAssignments(): Assignment[] {
  const day = 24 * 60 * 60 * 1000;
  const at = (d: number) => new Date(Date.now() + d * day).toISOString();
  return sortByDue([
    { id: "d1", name: "Problem Set 3", course: "CSC263: Data Structures", courseCode: "CSC263", dueAt: at(1), url: "#", points: 20, submitted: false },
    { id: "d2", name: "Lab Report 2", course: "CHM135: Chemistry", courseCode: "CHM135", dueAt: at(3), url: "#", points: 15, submitted: false },
    { id: "d3", name: "Essay Outline", course: "ENG140: Literature", courseCode: "ENG140", dueAt: at(6), url: "#", points: 10, submitted: false },
    { id: "d4", name: "Quiz 2 Reflection", course: "MAT137: Calculus", courseCode: "MAT137", dueAt: at(-2), url: "#", points: 5, submitted: true },
    { id: "d5", name: "Final Project Proposal", course: "CSC263: Data Structures", courseCode: "CSC263", dueAt: at(12), url: "#", points: 30, submitted: false },
  ]);
}
