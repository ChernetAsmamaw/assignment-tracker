# Pace: Hack the Valley 11 submission

**Tagline:** An AI study team that lives on top of Quercus: it plans your week, builds your exam timeline and measures what you actually know.

**Prize categories to select:** Top 3 (automatic), [MLH] Best Use of Gemini API, FDM: Best AI-Powered Tool for a Healthier Working Life, Best Healthcare & Well-being Hack, Best AI for Social Impact Hack. Add Best Solo Hack if you're entering alone, and Best Beginner Hack if everyone on the team has done at most one hackathon.

## Write-up (paste into the submission form)

### Inspiration
Quercus is where every UofT course lives, but it only answers one question: when is it due? It never tells you how much work something is, whether your week can hold it, how to prepare for a midterm, or which topics you're actually weak in. Students fill that gap with all-nighters, and burnout follows. We wanted to give every student what a great tutor, planner and coach would give them, built on the data their courses already have.

### What it does
Pace connects to Quercus and gives you a team of AI agents powered by Google Gemini.

- **Command bar (⌘K):** type anything, like "I work Tuesday 5 to 10" or "midterm in CSC263 on the 28th". Gemini function calling sends it to the right agent.
- **Planner agent:** fits every assignment step and exam study session into the hours you actually have each day. It understands plain-English changes to your week, flags crunch days, missing rest days and deadlines that won't fit (with how many hours short you are), and writes a weekly coaching note.
- **Study Plan agent:** give it an exam and it builds a day-by-day timeline using spaced repetition (learn, then review at 1, 3 and 7 days), interleaved timed practice and a mock exam. Weakest topics come first, and Gemini writes concrete activities for every session.
- **Performance agent:** reads your real Quercus grades (averages, trends, late and missed work), tells you where to focus, and quizzes you with Gemini-written questions. Quiz scores become a mastery score per topic that feeds back into your study plans.
- **Assignment coach:** breaks any assignment into steps with time estimates, catches easy-to-miss requirements, finds resources and answers questions from the instructor's own instructions.
- **Morning email:** today's plan, including study sessions, the week's status and what's due.

It deliberately helps students plan, understand and practise; it never writes graded work.

### How we built it
Next.js 15 (App Router, React 19, TypeScript) on Vercel. Quercus data comes from the Canvas LMS REST API, including submissions and grades. Gemini Flash is called over REST in two ways: structured JSON output with response schemas, so every agent returns typed data the app can schedule, and function calling for the command bar's routing. The planner and the spaced-repetition engine are our own deterministic algorithms, so the AI decides *what* and the code decides *when*. Upstash Redis stores progress, study plans, mastery and a cache of AI answers. Vercel Cron and Resend send the email. The UI is inspired by the Arc browser: a sidebar on a gradient frame, courses as coloured spaces and a ⌘K command bar. The whole stack runs on free tiers.

### Challenges we ran into
Making LLM output safe to build on: schemas plus clamping of every estimate. Splitting work between AI and algorithms, so plans stay explainable and repeatable. Keeping a live demo bulletproof: every agent has a rule-based fallback. Time zones: a 9am deadline means the work has to be finished the day before.

### Accomplishments that we're proud of
It runs on our real courses today. One sentence in the command bar can rebuild the week. Study plans, assignments and quiz results all feed one schedule.

### What we learned
Agents work best when each one has a narrow job and a deterministic engine underneath. Structured output turns an LLM from a chatbot into a component.

### What's next
Google and Outlook calendar sync, group task splitting for team projects, learning each student's real pace from completed steps, and opening it to any Canvas school.

### Built with
nextjs, react, typescript, gemini-api, google-ai-studio, function-calling, canvas-lms-api, vercel, upstash-redis, resend

**Links:** GitHub: https://github.com/ChernetAsmamaw/assignment-tracker · Live demo: https://assignment-tracker-ochre-xi.vercel.app

## 4-minute pitch script

**0:00 to 0:25 · Problem.** "Quercus tells you when something is due. It doesn't tell you how much work it is, whether your week can hold it, how to study for the midterm, or what you're actually weak at. That gap is where all-nighters and burnout come from."

**0:25 to 0:40 · Product.** "Pace gives every student an AI study team on top of Quercus: a planner, a study-plan builder and a performance coach, all powered by Gemini."

**0:40 to 1:20 · Today and the command bar.** Show the Today page: greeting, agent tiles, today's agenda. Press ⌘K and type "I work Tuesday 5 to 10pm". "Gemini function calling picked the Planner agent. Tuesday is now a light day and the week is replanned."

**1:20 to 2:10 · Study Plan agent.** ⌘K: "Midterm in CSC263 next Wednesday on heaps, AVL trees and hashing." The timeline opens. "Learn, then review at 1, 3 and 7 days, which is spaced repetition, then timed practice and a mock exam. Gemini wrote what to do in each session. Those sessions are already in my planner."

**2:10 to 2:50 · Performance agent.** Open Performance. "These are my real Quercus grades. CSC263 dropped 20 points, and the agent caught it." Take a 5-question quiz on heaps live and show the score ring and mastery bar. "My weakest topics get more reviews in my study plans."

**2:50 to 3:20 · Planner and assignment coach.** Show the two-week planner with a red day and the "won't fit" list. Open an assignment and click "Break it down with Gemini".

**3:20 to 4:00 · Close.** "The AI decides what to do, our algorithms decide when, and you get your evenings back. It runs on free tiers, works with any Canvas school, and it's live on my real courses right now."

## Likely Q&A
- **Where is Gemini used?** Function calling for the command bar, plus structured output for the planner changes, study topics and activities, quizzes, insights, assignment breakdowns, estimates, resources and Q&A.
- **Why not let the AI schedule everything?** LLMs are bad at arithmetic and not repeatable. Gemini decides what to do; our deterministic schedulers decide when. Same inputs always give the same plan.
- **Is it learning science or vibes?** Spaced repetition, active recall, interleaving and practice testing are some of the best-supported study techniques. The timeline encodes them directly.
- **Cost?** Zero. Gemini free tier, Vercel Hobby, Upstash free, Resend free. AI answers are cached so quotas last.
- **Cheating?** It plans, explains and quizzes. Its prompts forbid producing graded work.
- **Privacy?** One student's token in a Vercel environment variable, a password-protected site and nothing shared.

## Before you present
1. Add `GEMINI_API_KEY` in Vercel (Production), then merge the PR.
2. Create one real study plan ahead of time, and take one quiz so mastery isn't empty.
3. Open the Planner and Performance pages once so their notes are cached.
4. Practise the three ⌘K commands from the script.
5. Have this morning's email open in Outlook.
