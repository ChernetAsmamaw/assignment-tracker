export type Kind = "group" | "individual";

export type Status = "not_started" | "in_progress" | "done";

export interface Assignment {
  id: string;
  name: string;
  course: string;
  courseCode: string;
  dueAt: string | null;
  url: string;
  points: number | null;
  submitted: boolean;
  isGroup: boolean;
  description: string | null; // sanitized HTML from Quercus
  submissionTypes: string[];
  allowedAttempts: number | null;
  unlockAt: string | null;
  lockAt: string | null;
  gradingType: string | null;
}

export interface Resource {
  id: string;
  title: string;
  url: string;
  note: string;
}

export interface Step {
  id: string;
  title: string;
  hours: number;
  done: boolean;
}

export interface Progress {
  status: Status;
  percent: number;
  notes: string;
  resources: Resource[];
  // Manual override of Quercus's group/individual flag; null means use Quercus.
  kind: Kind | null;
  // Work plan from the AI breakdown; percent follows the checked steps when present.
  steps: Step[];
  // Hours of work the whole assignment needs; null means use the points-based guess.
  estimateHours: number | null;
  // Gemini's short approach and easy-to-miss requirements, kept from the last breakdown.
  guide: { approach: string; watchOuts: string[] } | null;
  updatedAt: string | null;
}

export const emptyProgress = (): Progress => ({
  status: "not_started",
  percent: 0,
  notes: "",
  resources: [],
  kind: null,
  steps: [],
  estimateHours: null,
  guide: null,
  updatedAt: null,
});

export const isGroupWork = (a: Assignment, p?: Progress) =>
  p?.kind ? p.kind === "group" : a.isGroup;

export const STATUS_LABEL: Record<Status, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
};

export const percentFromSteps = (steps: Step[]) => {
  const total = steps.reduce((n, s) => n + s.hours, 0);
  if (!total) return 0;
  return Math.round((steps.filter((s) => s.done).reduce((n, s) => n + s.hours, 0) / total) * 100);
};
