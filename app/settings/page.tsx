import { getAssignments, isDemo } from "@/lib/canvas";
import { courseColor } from "@/lib/colors";
import { formatDue } from "@/lib/format";
import { getSettings } from "@/lib/store";
import CoursePicker, { type PickerCourse } from "./CoursePicker";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
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
          <span className="eyebrow">Settings</span>
          <h1>Courses and assignments</h1>
          <p>Tick the courses and assignments you want in your morning reminder email. Anything you untick also leaves your lists, planner, Study and Today. Nothing changes on Quercus, and you can tick it again any time.</p>
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
