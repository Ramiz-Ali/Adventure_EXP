# AdventureEXP v2 — Milestone 1 Implementation Plan

**Status:** in progress · **Window needed:** none (Vercel deploys atomically; ship as ready)
**Scope owner:** Ramiz · **Client:** Adam Salzman

M1 is five items: three v1 defects, then two features. Below is what each one is, where it lives in the current code, and exactly what needs to change. File/line references are from `adventureexp_portal.html`, `lib/*.js`, and `supabase/migrations/`.

## Ground rules (apply to every item)
- **Vanilla JS stays vanilla** — no framework, no build step. New modules go in `lib/` and are exposed through the single bridge (`Object.assign(window, {...})`).
- **RLS on every new table/column.** Test with two browser sessions that one participant cannot read another's data.
- **Mutation convention:** `await DB.write(...)` → `await DB.hydrateAll({...})` → `render()`.
- **Deliverable:** all five live on production **plus a short M1 admin write-up** (new status + favorites view) with screenshots, written for Adam's staff, not developers.

---

## Status summary

| # | Item | Type | DB change? | Est. |
|---|------|------|-----------|------|
| 1.9 | Reset-password emails | defect | No (config only) | ~0.5d — likely already resolved, verify |
| 1.1 | Favorites visible to admin | feature | Yes (RLS policy) | ~0.5d |
| 1.2 | "Requested interview" vs "Applied" status | defect | Yes (status value) | ~1d |
| 1.10 | Rich text in job descriptions | feature | No (stores HTML in existing column) | ~1d |
| 1.8 | Admin soft-remove an application | defect | Yes (new column + RLS) | ~1d |

---

## 1.9 — Reset-password emails (Adam's #1)

**Ask:** Participant reset emails are not sending. Broken since v1.

**Current state:** The *code path is complete and correct* —
- `lib/auth.js:99` `sb.auth.resetPasswordForEmail(email, { redirectTo })`
- `lib/auth.js:104` `sb.auth.updateUser({ password })`
- Recovery-flow detection + set-new-password screen: `adventureexp_portal.html:3973–4040`
- Forgot form + handler: `renderForgotPassword` (~1029), `doForgot` (~1175)

**Diagnosis:** This is almost certainly **not an app bug** — it's Supabase Auth email delivery. Supabase's built-in auth mailer is rate-limited (~2–3/hr) and often spam-filed unless **custom SMTP** is configured and **redirect URLs** are allow-listed. Tested end-to-end on 2026-09 and it is currently sending and working.

**Plan (config, not code):**
1. Supabase → Authentication → **SMTP settings**: point auth emails at the SiteGround mailbox (same creds already used by the `send-notification` edge function). This removes the rate-limit/spam root cause permanently.
2. Supabase → Authentication → **URL Configuration**: confirm the production redirect (`adventure-exp.vercel.app`) is in the allowed list, and `auth.js` `redirectTo` resolves to production, not `localhost`.
3. Verify: request reset **3–4 times in a row** as a real participant; confirm inbox + spam delivery, link opens set-new-password, password actually changes.

**Acceptance:** A participant reliably receives the reset email and can set a new password. **Open question for Adam:** the exact case it failed for him (which email, participant vs admin, roughly when) — to confirm we fixed the same scenario.

---

## 1.1 — Favorites visible to admin

**Ask:** Admin sees which roles each participant has starred, not only where they applied.

**Current state:**
- `favorites` table (`0001_init.sql:207`), RLS is **own-only**: `favorites_all_own` (`0001_init.sql:526`).
- `hydrateAll` only loads the current user's favorites: `lib/db.js:332` (`.eq('participant_id', currentUser.id)`), attached to the logged-in student at `lib/db.js:346–349`.
- Participant UI uses `s.favorites` (a Set) in dashboard/listings/detail; admin has **no** favorites view.

**Plan:**
1. **DB / RLS (migration):** add an admin SELECT policy on `favorites`:
   ```sql
   drop policy if exists favorites_select_admin on favorites;
   create policy favorites_select_admin on favorites for select using (is_admin());
   ```
2. **lib/db.js `hydrateAll`:** for admins, fetch **all** favorites (drop the `participant_id` filter, like the other admin queries) and attach a `favorites` Set to each student in `studentFromDb`/post-map (mirror the `me.favorites` logic at `:346` but per-student).
3. **UI:** in the admin participant card (`rAdmStu`) or the Match-profile view, render the participant's starred jobs (job title + role/category badges). Read-only.

**Acceptance:** Admin opens a participant and sees the list of roles/jobs they starred. A participant still cannot see another participant's favorites (RLS test with two sessions).

---

## 1.2 — "Requested interview" distinct from "Applied"

**Ask:** A distinct "Requested interview" status on the admin side. Today a passive application and an active interview request look identical; one student's single request once showed as two applications.

**Current state:**
- Status enum: `0001_init.sql:158–159` → `check (status in ('applied','interviewing','offered','placed','withdrawn'))`.
- Participant action is literally labelled **"REQUEST INTERVIEW"** (`:1950`) but creates `status:'applied'` (`createApplication`, `lib/db.js`).
- Status labels/colors: `STATS` (`:429`), `STC` (`:430`).
- **Duplicate-application bug:** there is already a `unique (participant_id, job_id)` constraint (`0001_init.sql:163`) and `reqInterview` guards with `MA(jid)` + catches `23505` (`:1964–1980`). So DB-level duplicates should no longer occur — the "two applications" Adam saw is likely historical or a display artifact. **Verify in the current data before assuming more work is needed.**

**Plan:**
1. **DB (migration):** extend the status CHECK to include a new value — proposed `'requested'`:
   ```sql
   alter table applications drop constraint applications_status_check;
   alter table applications add constraint applications_status_check
     check (status in ('requested','applied','interviewing','offered','placed','withdrawn'));
   ```
2. **Creation point:** participant "REQUEST INTERVIEW" → set `status:'requested'` in `createApplication` (`lib/db.js`) instead of `'applied'`.
3. **UI:** add `'requested'` to `STATS` and a colour in `STC`; label it "Requested interview". Ensure admin lists (`rAdmApp`), employer views, and participant "Applied" tab render the new label. Transition stays `requested → interviewing → offered → placed`.
4. Recompute any status counts that assume the old set (admin overview `rAdmOv`, `:2327`).

**Open question for Adam (confirm before building):** In the current portal the *only* participant action is "Request interview" (stored as `applied`). Does he want (a) participant submissions simply relabelled to "Requested interview", or (b) two genuinely separate participant actions ("apply" vs "request interview")? (a) is the smaller change and matches the current single-button flow.

**Acceptance:** Admin can tell an interview request apart from any other application state at a glance; one request = one row.

---

## 1.10 — Rich text in job descriptions

**Ask:** Bold, italic, underline, bullet + numbered lists in the job description editor, rendered correctly everywhere a description appears (participant list, job detail, admin). **Sanitise on render.**

**Current state:**
- Editor is a plain `textarea` (`desc`) in the admin job form: `rAdmJobForm` (~`:3786`).
- Description is stored plain in `jobs.description` and rendered as text via `para('Position description', j.description)` in `rJobDetail` (`:1909`); also surfaces in listings/admin.

**Plan (no build step):**
1. **Editor:** replace the `desc` textarea with a small `contenteditable` field + a minimal toolbar (bold / italic / underline / UL / OL) using `document.execCommand` (adequate and dependency-free), writing HTML into the same `jobs.description` column. No schema change.
2. **Sanitise on render:** add a tiny allowlist sanitizer in a new `lib/sanitize.js` (allow `b,strong,i,em,u,ul,ol,li,p,br` only; strip attributes/scripts) exposed via the bridge, and run every `j.description` through it before injecting as HTML. Do **not** trust stored HTML raw. (DOMPurify via CDN is an alternative, but a 30-line allowlist keeps us dependency-free and CSP-safe.)
3. Render the sanitised HTML (not escaped text) in `rJobDetail`, participant listings, and admin job views.

**Acceptance:** Admin formats a description with bold/lists; it renders identically for participants and admin; pasted `<script>`/attributes are stripped.

---

## 1.8 — Admin soft-remove an application

**Ask:** Admin can remove an ineligible participant's application from a job (employer/job side) while the participant's own history still shows they applied. **Soft removal, history intact.**

**Current state:**
- No soft-delete concept on `applications`. Hard delete only happens via employer/job cascade (`:2985`, `:3027`).
- Status transitions handled by `setApplicationStatus` / `updateAppAll`; RLS lets participants withdraw own (`0001_init.sql:446`), admin has broad rights.

**Plan:**
1. **DB (migration):** add a soft-remove flag, e.g.
   ```sql
   alter table applications add column if not exists admin_removed_at timestamptz;
   ```
   (nullable; set = removed from the job/employer side, still a real row for history.)
2. **RLS:** ensure the employer-facing SELECT policy on `applications` **excludes** rows where `admin_removed_at is not null` (so removed apps disappear from the employer/job side), while the participant's own SELECT still returns them (history intact). Admin sees all. Enforce in RLS, not just UI.
3. **lib/db.js:** `adminRemoveApplication(appId)` → set `admin_removed_at = now()` (and an `undo` that nulls it).
4. **UI:** admin action button on the application row (`rAdmApp` ~`:2266`) → "Remove from job" (with confirm). Removed apps show muted/badged on the admin side; hidden from employer candidate lists; unchanged in the participant's "Applied" tab.

**Acceptance:** Admin removes an application → it vanishes from the employer/job side but the participant still sees it in their history. Verified with two sessions.

---

## Deploy & deliverable
- No deploy window needed. Ship each item to production as ready (Vercel auto-deploy from `main`; portal also mirrored to SiteGround `work.adventureexp.com` — keep both current).
- Any migration (1.1, 1.2, 1.8) is applied via Supabase SQL Editor and committed to `supabase/migrations/` (next numbers after `0012`).
- **M1 admin write-up** (required by Adam): short doc with screenshots covering the new "Requested interview" status and the admin favorites view — what changed, where it lives in Supabase, how to edit safely. Written for staff training.

## Consolidated open questions for Adam
1. **1.9:** the exact scenario it failed for you (email / participant vs admin / when), to confirm the same case is fixed.
2. **1.2:** relabel the existing single "Request interview" action to the new status, or do you want two separate participant actions (apply vs request interview)?
3. **1.8:** should a removed application also disappear from the *admin* active list (badged/hidden under a filter), or stay visible to admin with a "removed" badge? (Plan assumes visible-to-admin, hidden-from-employer.)

---

# Later milestones — for reference only (DO NOT START until M1 is signed off)

Milestones go one at a time on Upwork. Do not start M2 until Adam signs off M1. Listed here so the full v2 scope is on record.

## Milestone 2 — Participant flow (~5 days, no window)
- **2.2 Coordinator match.** Admin flags a job for a specific participant → participant dashboard shows a "Your coordinator has matched you with a position" card → click through to the job → can request an interview from there. Also emails the participant (Resend/edge function, same as v1 notifications). *(New: match-flag table/column + RLS, dashboard card, email event.)*
- **2.4 Interview-request cap.** A participant holds at most **2 active** interview requests. A slot frees when a request is denied, accepted or withdrawn. A participant in **Placed** status cannot request any. **Enforce in the database (RLS/trigger), not only the UI.**
- **3.4 Manual placement recording.** Admin records that a participant was placed and fills in the job details, for anyone who went through the process by phone / off-portal.
- **Deliverable:** all three live + M2 admin write-up (match flag, request cap, manual placement fields).

## Milestone 3 — The window night (~1 week, one 12–5 AM EDT window)
All four change data students already have. **Build and test on a copy of production data first, then migrate in the window** (Adam picks the date after testing).
- **1.4 Job status labels.** Posted / Accepting interviews / Spots filling / Filled replace Open & Filling. Admin controls + participant-side filtering + migration of existing jobs off the old statuses. *(This is **job** status — `jobs.status` — separate from 1.2's **application** status; no conflict.)*
- **1.5 Savings range.** Q4.2 becomes: $0–$1,000 / $1,000–$3,000 / $3,000–$4,000 / $4,000+ / Not sure yet. Rework the Financial Goals part of the match score (¼ of total) to the new bands, migrate existing answers, **re-run match results for everyone.**
- **1.6 Vehicle required.** A "Vehicle required" field on job postings that feeds the match % the same way the driver's-licence question does. Adds a match-profile question + scoring rule + re-run of every participant's results.
- **3.2 Revoke portal access.** Two per-participant settings: (a) block interview requests & reviews, (b) suspend portal access entirely. **Both enforced in RLS, not only hidden on screen.**
- **Also in M3:** a login-page notice the admin can toggle on/off from the admin panel (for the window night and future updates). Copy comes from Adam (placeholder until then).
- **Deliverable:** all four live after the window, matches re-run and spot-checked, + the **thorough** M3 admin write-up (the one Adam's team trains from).

## Not in this round (leave cheap hooks, build nothing)
Placement dates & early departure (2.1, 1.7, 3.1); employer profiles; follow & reviews (2.3, 4.2, 3.3); admin notified on interview request (3.5); application management & placement tracking (3.6); employer self-onboarding (4.1).

## Notes
- Adam's 2.4 note was cut off at "unab" — read as "unable to request further interviews once placed." Stated to him, not disputed.
- Login-notice copy is Adam's to write; placeholder until then.
- Hosting stays on Adam's Supabase + Vercel accounts.
