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
  updatedAt: string | null;
}

export const emptyProgress = (): Progress => ({
  status: "not_started",
  percent: 0,
  notes: "",
  resources: [],
  updatedAt: null,
});

export const STATUS_LABEL: Record<Status, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
};
