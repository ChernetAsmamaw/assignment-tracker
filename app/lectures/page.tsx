import { redirect } from "next/navigation";

// Class notes moved into Study, one page per course.
export default async function LecturesPage({ searchParams }: { searchParams: Promise<{ course?: string }> }) {
  const { course } = await searchParams;
  redirect(course ? `/study/${encodeURIComponent(course)}` : "/study");
}
