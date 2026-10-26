import "./globals.css";
import type { Metadata } from "next";
import Shell from "@/components/Shell";
import { cookies } from "next/headers";
import { COOKIE, authToken } from "@/lib/auth";
import { getAssignments, isDemo } from "@/lib/canvas";
import { courseColor } from "@/lib/colors";
import { storageProblem } from "@/lib/store";

export const metadata: Metadata = {
  title: "Pace: your AI study team",
  description: "Agents that plan your week, keep your notes for each course and measure what you know, from your Quercus courses.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The login page shares this layout, so only load courses for a signed-in visitor.
  const pw = process.env.APP_PASSWORD;
  const signedIn = !pw || (await cookies()).get(COOKIE)?.value === (await authToken(pw));
  const [assignments, problem] = signedIn ? await Promise.all([getAssignments().catch(() => []), storageProblem()]) : [[], null];
  const codes = [...new Set(assignments.map((a) => a.courseCode))].sort();
  const spaces = codes.map((code) => ({
    code,
    color: courseColor(code),
    open: assignments.filter((a) => a.courseCode === code && !a.submitted && a.dueAt && new Date(a.dueAt).getTime() > Date.now()).length,
  }));
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Shell spaces={spaces} signOut={!!process.env.APP_PASSWORD} demo={isDemo()}>
          {problem && <div className="banner" role="alert">{problem}</div>}
          {children}
        </Shell>
      </body>
    </html>
  );
}
