# Pace: Hack the Valley 11 submission

**Tagline:** Quercus tells you when it's due. Pace tells you when to start.

**Prize categories to select:** Top 3 (automatic), [MLH] Best Use of Gemini API, FDM: Best AI-Powered Tool for a Healthier Working Life, Best Healthcare & Well-being Hack, Best AI for Social Impact Hack. Add Best Solo Hack if you're entering alone, and Best Beginner Hack if everyone on the team has done at most one hackathon.

## Write-up (paste into the submission form)

### Inspiration
Every UofT student knows the week where a lab report, a problem set and an essay outline all land at once, and you only notice on Thursday night. Quercus lists due dates, but it never tells you how much work each assignment is, or whether your week can actually hold it. That gap is where all-nighters and burnout come from. We wanted a tool that sees the crunch coming days early and turns it into a plan you can keep.

### What it does
Pace connects to Quercus and pulls every assignment across your courses, including the instructor's full instructions. With one click, Google Gemini reads those instructions and breaks the assignment into specific steps with hour estimates, plus the easy-to-miss requirements. Pace then schedules all of your remaining work into the hours you say you can study each day, earliest deadline first, and shows your next two weeks.

It flags crunch days, counts how many full days you have, checks that you still get a light day, and lists any assignment that won't fit before its deadline and by how many hours. A Gemini coach writes a short, specific note about the week: what to start tonight, which day to protect, when to ask for an extension. Each morning an email lands in your inbox with today's plan. On any assignment you can ask Gemini questions answered from the real instructions, and have it find key concepts and resources that you save with one click.

Pace helps students plan and understand their work; it is deliberately built not to write the graded work for them.

### How we built it
Next.js 15 with the App Router and TypeScript, deployed on Vercel. Quercus data comes from the Canvas LMS REST API with a personal access token. Gemini 2.5 Flash is called over REST with structured JSON output (response schemas), so every AI response is typed data the app can schedule, not loose text. The scheduler is our own deterministic algorithm: it splits steps across days by capacity, respects morning versus evening deadlines in Toronto time, and computes the burnout signals. Upstash Redis stores progress, steps, settings and a cache of AI answers so reloading never re-bills Gemini. Vercel Cron and Resend send the daily email.

### Challenges we ran into
Making AI output something a scheduler can trust: we used Gemini's response schemas and clamp every estimate to sane bounds. Keeping the demo bulletproof: every Gemini feature has a rule-based fallback, so the app never shows a blank screen. And time zones: a deadline at 9am means the work has to be done the day before, so the planner reasons in Toronto time.

### Accomplishments that we're proud of
It runs on our real Quercus courses today and emails a real inbox every morning. The plan updates the moment you check off a step or change your study hours.

### What we learned
Structured output turns an LLM from a chatbot into a component. And the most useful thing an assistant can say to a stressed student is often "this doesn't fit, start tonight or ask for an extension now".

### What's next
Calendar sync (Google and Outlook) so the plan blocks real time, group step assignment for team projects, and learning each student's real pace from how long steps actually take.

### Built with
nextjs, react, typescript, gemini-api, google-ai-studio, canvas-lms-api, vercel, upstash-redis, resend

**Links:** GitHub: https://github.com/ChernetAsmamaw/assignment-tracker · Live demo: https://assignment-tracker-ochre-xi.vercel.app

## 4-minute pitch script

**0:00 to 0:30 · The problem.** "Hands up if you've had a week where three assignments landed at once and you only noticed the night before. Quercus tells you *when* something is due. It never tells you *how much work* it is, or whether your week can hold it. That's where all-nighters and burnout come from."

**0:30 to 0:50 · The product.** "Pace is a study coach that connects to Quercus and turns your deadlines into a plan that fits the hours you actually have."

**0:50 to 1:50 · Demo 1: break it down.** Open the home page. Point at the gallery and the *Today's plan* strip. Open a real assignment with a long description. Click **✦ Break it down with Gemini**. "Gemini just read the instructor's instructions and gave me specific steps with time estimates, and it caught that we need ACS citations and the raw data as an appendix." Check off a step and show progress move.

**1:50 to 2:50 · Demo 2: the plan.** Go to **Plan**. "Every step from every course, scheduled into my study hours." Point at the status card and the *Won't fit* list. "Pace already knows I'm two hours short for this problem set, days before it's due." Change weekday hours from 4 to 2 and click **Replan**: the week turns red. "This is what burnout looks like before it happens." Read the Gemini coach's note aloud.

**2:50 to 3:20 · Demo 3: ask and the email.** Back on the assignment, ask "What citation style do they want?". Then show this morning's email in Outlook: today's plan, the week's status and what's due.

**3:20 to 4:00 · Close.** "Gemini does the reading and estimating, our scheduler does the math, and Pace protects your time. It's live on my real courses today. Quercus tells you when it's due; Pace tells you when to start."

## Likely Q&A
- **How do you use Gemini?** Five features, all with structured JSON output: step breakdown, batch hour estimates, the weekly coach, concept and resource extraction, and Q&A over the instructions. Answers are cached in Redis.
- **What if Gemini is wrong?** Every step and estimate is editable, and estimates are clamped. The scheduler is deterministic, so the same inputs always give the same plan.
- **Isn't this cheating?** No. Pace plans and explains; its prompt tells it never to produce the graded work.
- **Privacy?** One student's token, stored as a Vercel environment variable; the site is password protected and nothing is shared.
- **Other schools?** Any Canvas school works by changing `CANVAS_BASE_URL`.

## Before you present
1. Add `GEMINI_API_KEY` in Vercel (Production) and redeploy.
2. Open the Plan page once so the coach note is cached.
3. Click **✦ Estimate with Gemini** on the Plan page so the week is realistic.
4. Pick one assignment with a rich description for the live breakdown.
5. Trigger an email ahead of time so it's in your inbox to show.
