import { gemini, hasGemini } from "../gemini";
import {
  addDays, daysBetween, isDay, newId, OPP_KINDS, profileSummary, torontoToday,
  type ApplicationPlan, type CareerProfile, type OppKind, type Opportunity, type PlanStep,
} from "../careers";

// Application agent: scores fit, writes a dated plan for each application and drafts
// a cover letter from your profile. Every function has a rule-based fallback.

const CAREER_COACH =
  "You are a career coach for university students applying to internships, practicums, co-ops and conferences, mostly in Canada. " +
  "You are specific and practical, and you never invent experience the student doesn't have.";

export const describeOpp = (o: Opportunity) =>
  [
    `${o.title} at ${o.organization} (${o.kind})`,
    o.location && `Location: ${o.location}`,
    `Deadline: ${o.deadline ?? "rolling or unknown"}`,
    o.startDate && `Starts: ${o.startDate}`,
    o.url && `Posting: ${o.url}`,
    o.summary && `About: ${o.summary}`,
    o.requirements.length && `Requirements:\n${o.requirements.map((r) => `- ${r}`).join("\n")}`,
    o.notes && `Student's notes: ${o.notes.slice(0, 1500)}`,
  ]
    .filter(Boolean)
    .join("\n");

// ---------- Fit ----------

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z][a-z+#.]{2,}/g) ?? []);
const STOP = new Set(["and", "the", "for", "with", "you", "our", "are", "will", "your", "from", "this", "that", "have", "who", "all", "any", "open", "role", "team", "work"]);

// Keyword overlap between your profile and the posting, plus a bump for a location you'd go to.
export function heuristicRelevance(o: Pick<Opportunity, "title" | "summary" | "requirements" | "location">, p: CareerProfile): number {
  const mine = [...words(`${p.roles} ${p.skills} ${p.interests} ${p.program}`)].filter((w) => !STOP.has(w));
  const theirs = words(`${o.title} ${o.summary} ${o.requirements.join(" ")}`);
  const hits = mine.filter((w) => theirs.has(w)).length;
  const place = o.location.toLowerCase();
  const near = [p.location.split(",")[0], ...p.regions.split(/[,;]/)].some((r) => {
    const t = r.trim().toLowerCase().split(" ").pop() ?? "";
    return t.length > 2 && place.includes(t);
  });
  return Math.min(95, 45 + hits * 8 + (near || /remote|canada/.test(place) ? 10 : 0));
}

const KIND_ENUM = OPP_KINDS;

export interface Extracted {
  title: string;
  organization: string;
  kind: OppKind;
  location: string;
  deadline: string | null;
  startDate: string;
  summary: string;
  requirements: string[];
  whyRelevant: string;
  relevance: number;
}

const EXTRACT_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    organization: { type: "STRING" },
    kind: { type: "STRING", enum: KIND_ENUM },
    location: { type: "STRING" },
    deadline: { type: "STRING", description: "YYYY-MM-DD, or empty if none is given" },
    startDate: { type: "STRING" },
    summary: { type: "STRING" },
    requirements: { type: "ARRAY", items: { type: "STRING" } },
    whyRelevant: { type: "STRING" },
    relevance: { type: "INTEGER" },
  },
  required: ["title", "organization", "kind", "location", "summary", "requirements", "whyRelevant", "relevance"],
};

// Fills in the fields of a posting you paste (or just score one you typed in), and rates the fit.
export async function analyzePosting(input: Partial<Opportunity> & { posting?: string }, p: CareerProfile): Promise<Partial<Extracted>> {
  if (!hasGemini()) return {};
  try {
    const { data } = await gemini<Extracted>({
      system: CAREER_COACH,
      prompt:
        `Today is ${torontoToday()}.\n\nStudent profile:\n${profileSummary(p)}\n\n` +
        `Opportunity so far:\n${JSON.stringify({ title: input.title, organization: input.organization, location: input.location, url: input.url, deadline: input.deadline }, null, 1)}\n\n` +
        (input.posting ? `Posting text:\n${input.posting.slice(0, 8000)}\n\n` : "") +
        "Fill in the fields from the posting (keep what's already given unless the posting corrects it). summary: 2 sentences. " +
        "requirements: up to 6 short items. relevance: 0 to 100, how well this fits the student's background, goals and location. " +
        "whyRelevant: one sentence on the fit, naming the specific skill or goal it matches, or the gap.",
      schema: EXTRACT_SCHEMA,
      fast: !input.posting,
    });
    return { ...data, deadline: isDay(data.deadline) ? data.deadline : null, relevance: clamp(data.relevance) };
  } catch (e) {
    console.error("analyze posting", e);
    return {};
  }
}

export const clamp = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

// ---------- Application plan ----------

interface Template { title: string; detail: string; at: number } // at: share of the runway, 0 = today, 1 = deadline

const JOB_STEPS: Template[] = [
  { title: "Read the posting and pick out the top 5 keywords", detail: "Highlight required skills, tools and values. These drive your resume and letter.", at: 0 },
  { title: "Research the team and recent projects", detail: "Skim the company site, recent news and the team's LinkedIn. Note one thing you'd genuinely like to work on.", at: 0.15 },
  { title: "Tailor your resume to the keywords", detail: "Reorder bullets so the most relevant project is first. Mirror their wording where it's true.", at: 0.3 },
  { title: "Ask for a referral or a quick chat", detail: "Message an alum or someone on the team. A referral often matters more than the letter.", at: 0.4 },
  { title: "Draft the cover letter", detail: "Use the generator below, then rewrite the opening in your own voice.", at: 0.55 },
  { title: "Get feedback on resume and letter", detail: "Career centre, a friend in the field, or a TA. Fix anything vague.", at: 0.75 },
  { title: "Submit the application", detail: "Submit early: some postings close before the listed date once they have enough applicants.", at: 0.92 },
  { title: "Follow up", detail: "If you hear nothing in 7 to 10 days, send a short, polite note to the recruiter or your contact.", at: 1.4 },
];

const EVENT_STEPS: Template[] = [
  { title: "Check eligibility, dates and costs", detail: "Look for student pricing, volunteer spots and travel or diversity grants.", at: 0 },
  { title: "Apply for funding", detail: "Ask your department, student union and the conference itself about travel awards.", at: 0.3 },
  { title: "Prepare your submission or registration", detail: "Abstract, poster, project or short statement, depending on what they ask for.", at: 0.55 },
  { title: "Submit and register", detail: "Register before early-bird pricing ends.", at: 0.9 },
  { title: "Plan who to meet", detail: "List 5 speakers or companies attending and prepare a 30-second intro.", at: 1.1 },
];

export function scheduleSteps(templates: { title: string; detail: string; at: number }[], deadline: string | null, today = torontoToday()): PlanStep[] {
  // Aim to finish two days before the deadline; without one, give it two weeks.
  const runway = deadline ? Math.max(0, daysBetween(today, deadline) - 2) : 14;
  return templates.map((t) => {
    // Steps past 1 (following up, the event itself) land a week or more after you submit.
    let due = t.at > 1 ? addDays(today, runway + 7 + Math.round((t.at - 1) * 7)) : addDays(today, Math.round(runway * Math.max(0, t.at)));
    if (deadline && t.at <= 1 && due > deadline) due = deadline;
    return { id: newId(), title: t.title.slice(0, 140), detail: t.detail.slice(0, 400), due, done: false };
  });
}

export async function makePlan(o: Opportunity, p: CareerProfile): Promise<ApplicationPlan> {
  const event = o.kind === "conference" || o.kind === "event";
  const fallback: ApplicationPlan = {
    strategy: event
      ? "Lock in funding and registration early, then prepare so you leave with contacts, not just notes."
      : "Lead with the experience closest to the posting, get a referral if you can, and submit a few days early.",
    focus: event
      ? ["Funding and registration deadlines", "A clear reason you're attending", "People you want to meet"]
      : ["A resume tailored to the posting's keywords", "A referral or warm contact", "A specific, honest cover letter"],
    steps: scheduleSteps(event ? EVENT_STEPS : JOB_STEPS, o.deadline),
    talkingPoints: p.skills ? p.skills.split(/[,;]/).map((s) => s.trim()).filter(Boolean).slice(0, 3).map((s) => `Your experience with ${s}`) : [],
    watchOuts: o.deadline ? [] : ["No deadline listed: many roles close as soon as they have enough applicants, so apply soon."],
    ai: false,
    generatedAt: new Date().toISOString(),
  };
  if (!hasGemini()) return fallback;

  try {
    const runway = o.deadline ? daysBetween(torontoToday(), o.deadline) : null;
    const { data } = await gemini<{ strategy: string; focus: string[]; talkingPoints: string[]; watchOuts: string[]; steps: { title: string; detail: string; at: number }[] }>({
      system: CAREER_COACH,
      prompt:
        `Today is ${torontoToday()}${runway != null ? `, ${runway} days before the deadline` : ", no deadline is listed"}.\n\n` +
        `Student profile:\n${profileSummary(p)}\n\nOpportunity:\n${describeOpp(o)}\n\n` +
        "Write an application plan. strategy: 2 sentences on how to win this one. focus: the 3 things to prioritize, most important first. " +
        "steps: 5 to 8 concrete steps in order, specific to this role and this student (name the project, skill or contact to use). " +
        "For each step give at: a number from 0 (today) to 1 (the deadline) for when to finish it; a follow-up after applying can be above 1. " +
        "Leave a buffer: the submit step should be around 0.9. talkingPoints: 3 parts of the student's background to lead with, tied to the requirements. " +
        "watchOuts: up to 3 easy-to-miss requirements or risks (work permit, transcripts, references, portfolio, location). Each item under 160 characters.",
      schema: {
        type: "OBJECT",
        properties: {
          strategy: { type: "STRING" },
          focus: { type: "ARRAY", items: { type: "STRING" } },
          steps: {
            type: "ARRAY",
            items: { type: "OBJECT", properties: { title: { type: "STRING" }, detail: { type: "STRING" }, at: { type: "NUMBER" } }, required: ["title", "detail", "at"] },
          },
          talkingPoints: { type: "ARRAY", items: { type: "STRING" } },
          watchOuts: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["strategy", "focus", "steps", "talkingPoints", "watchOuts"],
      },
    });
    const steps = (data.steps ?? []).filter((s) => s.title).slice(0, 10).map((s) => ({ ...s, at: Math.min(2, Math.max(0, Number(s.at) || 0)) }));
    return {
      strategy: data.strategy || fallback.strategy,
      focus: (data.focus ?? []).slice(0, 4),
      steps: steps.length >= 3 ? scheduleSteps(steps, o.deadline) : fallback.steps,
      talkingPoints: (data.talkingPoints ?? []).slice(0, 4),
      watchOuts: (data.watchOuts ?? []).slice(0, 4),
      ai: true,
      generatedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error("application plan", e);
    return fallback;
  }
}

// ---------- Cover letter ----------

export type Tone = "warm" | "formal" | "concise";

export async function writeCoverLetter(o: Opportunity, p: CareerProfile, tone: Tone = "warm", extra = ""): Promise<{ letter: string; ai: boolean }> {
  if (hasGemini()) {
    try {
      const { data } = await gemini<string>({
        system:
          CAREER_COACH +
          " Write cover letters that sound like a real, thoughtful student: no clichés (no 'I am writing to express my interest', no 'passionate'), " +
          "concrete examples from the student's actual experience, and a clear link to what the role needs. Never invent facts; if something is missing, write [bracketed placeholder].",
        prompt:
          `Student profile:\n${profileSummary(p)}\n\nOpportunity:\n${describeOpp(o)}\n\n` +
          `Write a ${tone === "concise" ? "short (about 180 words)" : "one-page (250 to 350 words)"} cover letter in a ${tone} tone. ` +
          "Structure: a specific opening about why this organization and role; one or two paragraphs mapping 2 or 3 of the student's real experiences to the requirements; " +
          `a brief close with availability${o.startDate ? ` (${o.startDate})` : ""}. Start with "Dear Hiring Team," unless a name is known, and sign with the student's name. Plain text only.` +
          (extra ? `\n\nThe student also asked: ${extra.slice(0, 600)}` : ""),
        temperature: 0.7,
      });
      return { letter: data, ai: true };
    } catch (e) {
      console.error("cover letter", e);
    }
  }
  const name = p.name || "[Your name]";
  const skills = p.skills.split(/[,;]/).map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const letter = [
    "Dear Hiring Team,",
    "",
    `I'm ${p.program ? `a ${p.year ? `${p.year} ` : ""}${p.program} student` : "a student"} at ${p.school || "[school]"}, and I'd like to apply for the ${o.title} position at ${o.organization}. [One sentence on why ${o.organization} specifically: a product, project or value that draws you to them.]`,
    "",
    `${o.requirements.length ? `The role asks for ${o.requirements.slice(0, 2).join(" and ").toLowerCase()}. ` : ""}${skills.length ? `I've built experience with ${skills.join(", ")}` : "[Your most relevant experience]"}, most recently [project or job: what you did and the result, with a number if you can].`,
    "",
    "[A second example that matches another requirement, and what you learned from it.]",
    "",
    `I'd welcome the chance to bring this to ${o.organization}${o.startDate ? ` starting ${o.startDate}` : ""}. Thank you for your time and consideration.`,
    "",
    "Sincerely,",
    name,
  ].join("\n");
  return { letter, ai: false };
}
