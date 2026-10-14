# Assignment Tracker

A small site that pulls your assignments from Quercus, lets you track progress and collect the resources you used for each one, and emails you a reminder each morning about anything due soon.

- **Assignments** come from the Quercus (Canvas) API using your personal access token, across all your active courses.
- **Progress and resources** (status, % complete, links, notes) are saved in Upstash Redis.
- **Reminders** go out daily at 8am Toronto time (12:00 UTC) via Resend, listing everything due in the next 3 days that isn't submitted or marked done. No email is sent on days with nothing due.
- The site is password protected.

## Setup

1. **Quercus token**: Quercus → Account → Settings → *+ New access token*. Copy it.
2. **Resend**: sign up at resend.com **with your Outlook address**, create an API key. (Without your own domain, Resend can only send to the address you signed up with, which is all you need.)
3. **Deploy on Vercel**: import this repo, then in the project's *Storage* tab add **Upstash for Redis** (free). That sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
4. **Environment variables** (Project → Settings → Environment Variables), see `.env.example`:
   - `CANVAS_TOKEN`, `APP_PASSWORD`, `RESEND_API_KEY`, `REMINDER_TO` (your Outlook address)
   - `CRON_SECRET` (any long random string), `APP_URL` (your `.vercel.app` URL)
   - optional: `REMIND_DAYS` (default 3), `REMINDER_FROM`
5. Redeploy. Check the email any time at `/api/cron/remind?preview=1` with header `Authorization: Bearer <CRON_SECRET>`.

## Local development

```
npm install
cp .env.example .env.local   # fill in what you have
npm run dev
```

Without `CANVAS_TOKEN` it shows sample assignments; without Redis it saves to `.data/progress.json`.
