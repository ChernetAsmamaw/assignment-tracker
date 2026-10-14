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
}

export interface Resource {
  id: string;
  title: string;
  url: string;
  note: string;
}

export interface Progress {
  status: Status;
  percent: number;
  notes: string;
  resources: Resource[];
  // Manual override of Quercus's group/individual flag; null means use Quercus.
  kind: Kind | null;
  updatedAt: string | null;
}

export const emptyProgress = (): Progress => ({
  status: "not_started",
  percent: 0,
  notes: "",
  resources: [],
  kind: null,
  updatedAt: null,
});

export const isGroupWork = (a: Assignment, p?: Progress) =>
  p?.kind ? p.kind === "group" : a.isGroup;

export const STATUS_LABEL: Record<Status, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
};
