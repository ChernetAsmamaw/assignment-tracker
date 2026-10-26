# Pace: Hack the Valley 11 submission

**Tagline:** An AI study team on top of Quercus that plans your week around the student you actually are today: how you slept, how you feel and how fast you really work.

**Prize categories to select:** Top 3 (automatic), [MLH] Best Use of Gemini API, FDM: Best AI-Powered Tool for a Healthier Working Life. Add Best Solo Hack if you're entering alone, and Best Beginner Hack if everyone on the team has done at most one hackathon.

## Write-up (paste into the submission form)

### Inspiration
Quercus tells you when something is due. It never tells you whether your week can hold it, and every planner app assumes you're the same person every day. You aren't. After four hours of sleep, a "4 hour study day" is a lie, and the plan that ignores it is how one bad night turns into an all-nighter and then burnout. We wanted a planner that notices how you're doing, adapts, and learns how long your work really takes.

### What it does
Pace connects to Quercus and gives you a team of AI agents powered by Google Gemini.

- **Command bar (⌘K):** say anything, like "I work Tuesday 5 to 10" or "I slept 4 hours and I'm wiped". Gemini function calling sends it to the right agent.
- **Wellbeing agent:** a 10-second morning check-in (energy and sleep). Running low? Today gets lighter and the rest moves to later days automatically. A transparent strain score catches burnout early from your energy, sleep, workload, missing rest days and after-midnight sessions, and tells you which of those is driving it.
- **Focus timer that learns your pace:** press ▶ on any block for a 25/5 focus session. Finished blocks teach Pace how long work in each course really takes you ("you run 30% over estimates in CSC263"), and the planner re-estimates that course from then on.
- **Planner agent:** fits every assignment step into the hours you actually have, understands plain-English changes to your week, flags crunch days, missing rest days and deadlines that won't fit, and writes a weekly coaching note.
- **Calendar sync:** subscribe once in Google Calendar, Outlook or Apple Calendar and every study block and deadline sits next to your classes and shifts.
- **Performance agent:** reads your real Quercus grades, spots courses that are slipping and quizzes you with Gemini-written questions to measure each topic.
- **Class notes, assignment coach, internship Scout and a morning email** round it out.

It deliberately helps students plan, understand and practise; it never writes graded work, and it never gives medical advice.

### How we built it
Next.js 15 (App Router, React 19, TypeScript) on Vercel. Quercus data comes from the Canvas LMS REST API, including grades. Gemini Flash is called over REST with structured JSON output (typed data the app can schedule) and function calling (the command bar). The numbers are ours and deterministic: an earliest-deadline-first scheduler in Toronto time, a capacity model from energy and sleep, a strain score with named drivers, and pace learning that compares actual to planned minutes and shrinks toward 1 (as if you'd already done an hour on plan) so one slow night can't double your plan. Gemini decides what to say and what to do; the code decides how much and when. A Google Sheet stores everything through the free Sheets API, Vercel Cron and Resend send the email, and the calendar is a standard iCalendar feed. The whole stack runs on free tiers.

### Challenges we ran into
Making adaptation safe: learned pace has to move with real evidence but not overreact, so we used shrinkage and clamping, and only apply it after two finished blocks. Keeping AI out of the arithmetic, so plans stay explainable and repeatable. Time zones and daylight saving in both the scheduler and the calendar feed. Keeping a live demo bulletproof: every agent has a rule-based fallback.

### Accomplishments that we're proud of
One sentence ("slept 4 hours, I'm wiped") replans the day. The strain score explains itself instead of being a black box. It runs on our real courses today.

### What we learned
Agents work best with a narrow job and a deterministic engine underneath. Wellbeing features only help if they cost the student almost nothing, so the check-in is two taps.

### What's next
Learning a student's best hours of the day from focus sessions, group task splitting, two-way calendar sync that reads busy times, and opening it to any Canvas school.

### Built with
nextjs, react, typescript, gemini-api, google-ai-studio, function-calling, canvas-lms-api, icalendar, vercel, google-sheets-api, resend

**Links:** GitHub: https://github.com/ChernetAsmamaw/assignment-tracker · Live demo: https://assignment-tracker-ochre-xi.vercel.app

## 4-minute pitch script

**0:00 to 0:25 · Problem.** "Every planner assumes you're the same person every day. You're not. After four hours of sleep, your 4-hour study plan is a lie, and that's how one bad night becomes an all-nighter and then burnout."

**0:25 to 0:40 · Product.** "Pace is an AI study team on top of Quercus that plans around the student you actually are today."

**0:40 to 1:30 · Check-in.** On Today, tap "Low" and enter 5 hours of sleep. "Today just went from 4 hours to 2.5, and the rest moved to later days before the deadlines. Gemini tells me what to start with." Then ⌘K: "I work Tuesday 5 to 10pm". "Function calling picked the Planner agent, and Tuesday is light now."

**1:30 to 2:20 · Focus and pace.** Press ▶ on a block, show the timer, then "I'm done, finished this block". Open Wellbeing. "Pace learned I take 20% longer than estimated in CSC263, so every CSC263 block is now longer. It's not a guess: it's actual over planned minutes, smoothed so one slow night can't wreck my plan."

**2:20 to 3:00 · Strain.** Point at the gauge and drivers. "This is a strain score, not a diagnosis, and it shows its work: low energy, short sleep, no rest day this week. Gemini turns that into three things to change this week."

**3:00 to 3:30 · Calendar and grades.** Show the calendar link and the blocks in Google Calendar. Flash Performance: "Real Quercus grades, and it caught CSC263 slipping."

**3:30 to 4:00 · Close.** "The AI decides what to say, our algorithms decide how much and when, and you get your evenings back. Free tiers, any Canvas school, and it's live on my real courses."

## Likely Q&A
- **Where is Gemini used?** Function calling for the command bar; structured output for check-in replies, the wellbeing note, planner changes, quizzes, insights, assignment breakdowns and estimates.
- **How is pace learned?** Finished focus blocks only. Per course, (actual minutes + 60) / (planned minutes + 60) over the last 12 blocks, clamped to 0.6 to 2x, applied after 2 blocks. Planned minutes are stored before pace is applied, so it doesn't compound.
- **Is the strain score medical?** No. It's a transparent sum of named signals with fixed weights, meant to prompt a small change early. The coach never gives medical advice.
- **Why not let the AI schedule?** LLMs are bad at arithmetic and not repeatable. Same inputs always give the same plan.
- **Privacy?** One student's data, kept in their own Google Sheet, a password-protected site, and the calendar link is a secret token derived from the password.
- **Cost?** Zero: Gemini free tier, Vercel Hobby, the Google Sheets API, Resend free.

## Before you present
1. Make sure `GEMINI_API_KEY` and the Google Sheet (`GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`) are set in Vercel (Production), then merge the PR.
2. Check in for the last few days and finish two focus blocks in one course so the pace card and strain chart aren't empty.
3. Subscribe to the calendar feed in Google Calendar the day before (Google refreshes subscribed calendars every few hours).
4. Open Wellbeing, Planner and Performance once so their notes are cached.
5. Practise the two ⌘K commands from the script.
