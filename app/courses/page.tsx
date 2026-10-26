import { getAssignments, isDemo } from "@/lib/canvas";
import { courseColor } from "@/lib/colors";
import { formatDue } from "@/lib/format";
import { getSettings } from "@/lib/store";
import CoursePicker, { type PickerCourse } from "./CoursePicker";

export const dynamic = "force-dynamic";

export default async function CoursesPage() {
  const [assignments, settings] = await Promise.all([getAssignments(), getSettings()]);
  const now = Date.now();
  const byCode = new Map<string, PickerCourse>();
  for (const a of assignments) {
    const c = byCode.get(a.courseCode) ?? { code: a.courseCode, name: a.course, color: courseColor(a.courseCode), upcoming: [], past: [] };
    const past = !!a.dueAt && new Date(a.dueAt).getTime() < now;
    (past ? c.past : c.upcoming).push({ id: a.id, name: a.name, due: formatDue(a.dueAt), submitted: a.submitted });
    byCode.set(a.courseCode, c);
  }
  // Quercus lists oldest first; show the most recent past work at the top of its section.
  const courses = [...byCode.values()].sort((x, y) => x.code.localeCompare(y.code)).map((c) => ({ ...c, past: c.past.reverse() }));

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">Courses</span>
          <h1>Choose what Pace tracks</h1>
          <p>Untick a course or an assignment to leave it out of your lists, planner, Study, Today and the morning email. Nothing changes on Quercus, and you can tick it again any time.</p>
        </div>
      </header>
      {isDemo() && <div className="banner">Showing sample courses. Add your Quercus token (CANVAS_TOKEN) to choose from yours.</div>}
      {courses.length === 0 ? (
        <p className="muted">No courses with assignments came back from Quercus.</p>
      ) : (
        <CoursePicker courses={courses} initial={{ courses: settings.excludedCourses, assignments: settings.excludedAssignments }} />
      )}
    </>
  );
}
