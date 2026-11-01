// Study: one page per course that lists your notes, oldest first.

// Course codes go in URLs, and Quercus codes can contain spaces.
export const studyHref = (courseCode: string, lectureId?: string) => `/study/${encodeURIComponent(courseCode)}${lectureId ? `/${lectureId}` : ""}`;

// "CSC263: Data Structures" reads "Data Structures" under its code, so the code isn't shown twice.
export const courseTitle = (code: string, name: string) => (name.startsWith(code) ? name.slice(code.length).replace(/^[\s:–-]+/, "") : name);

export function courseFromParam(param: string): string {
  try {
    return decodeURIComponent(param);
  } catch {
    return param;
  }
}

// Extra blocks the Planner can fit in before an assignment's own work.
export interface StudyTask {
  title: string;
  href: string;
  hours: number;
}
