import type { Opportunity } from "./careers";

// Roles you asked to have on your list. Each one is added once, the next time the careers page
// loads; after that it's an ordinary opportunity you can edit, mark applied or delete, and it
// won't come back. Give every entry a fixed id so it can't be added twice.
export type SeedRole = Pick<Opportunity, "id" | "title" | "organization" | "kind" | "location" | "url" | "deadline" | "startDate" | "summary" | "requirements" | "notes" | "priority">;

export const SEED_ROLES: SeedRole[] = [
  {
    id: "pfizer-stats-aiml-2027",
    title: "Statistics and AI/ML Summer Internship 2027",
    organization: "Pfizer (through AtriumWorks)",
    kind: "internship",
    location: "On-site, US (8 Pfizer sites)",
    url: "https://pfizerstatistics-internprogram-atriumworks.icims.com/jobs/intro",
    deadline: "2027-01-31",
    startDate: "Summer 2027, 12 weeks between May and September",
    summary:
      "Pfizer's summer internship program with a Statistics track and an AI/ML track; you can apply to one or both. Run jointly by Pfizer and AtriumWorks, paid $40/hr. On-site at one of: San Diego CA, Groton CT, Andover MA, Cambridge MA, New York NY, Pearl River NY, Collegeville PA or Bothell WA.",
    requirements: [
      "Active graduate student in a full-time accredited program during the internship",
      "At least one year of graduate study completed by June 2027",
      "Authorized to work in the U.S. for summer 2027",
      "On-site at one of eight Pfizer offices; housing is not provided",
    ],
    notes:
      "Rolling, highly selective recruitment, so apply early. Interviews usually run November to March. As of Nov 15, 2026 the iCIMS page said there were no openings posted yet, so check the link for when the application opens.",
    priority: true,
  },
];
