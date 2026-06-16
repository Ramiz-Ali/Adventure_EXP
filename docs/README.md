# AdventureEXP — Implementation Docs

Reference docs for the backend wiring work. Each file is one self-contained topic. Read them in the order listed below if you are new to the project.

## Project context

- Frontend already exists as `../adventureexp_portal.html` (single-file vanilla JS, ~2,200 lines).
- Backend stack: Supabase (Postgres + Auth + Storage + Edge Functions) + Resend for email.
- Deployment: Vercel (frontend only — Supabase hosts everything else).
- Two roles: **participant** (student) and **admin**. No employer login in v1.
- Deadline: 2026-07-17.

## Foundation (do first — everything blocks on these)

| # | Doc | Purpose |
| - | --- | ------- |
| 00 | [overview.md](00-overview.md) | Milestone breakdown, timeline, deliverables |
| 01 | [supabase-setup.md](01-supabase-setup.md) | Project creation, env vars, client init |
| 02 | [database-schema.md](02-database-schema.md) | All tables, indexes, triggers |
| 03 | [rls-policies.md](03-rls-policies.md) | Row-level security for every table + test plan |
| 04 | [storage.md](04-storage.md) | Photo buckets, resize, retry |
| 05 | [frontend-wiring-pattern.md](05-frontend-wiring-pattern.md) | How to migrate hardcoded arrays to fetch calls without breaking `render()` |

## Milestone 1 — Core Backend

| # | Doc | Purpose |
| - | --- | ------- |
| 06 | [authentication.md](06-authentication.md) | Signup, login, admin login, password reset |
| 07 | [participant-profile.md](07-participant-profile.md) | Profile CRUD, photo, visibility, completion % |
| 08 | [program-builder.md](08-program-builder.md) | 6-section matchmaking questionnaire |
| 09 | [employer-management.md](09-employer-management.md) | Admin employer CRUD |
| 10 | [job-management.md](10-job-management.md) | Admin job CRUD + CPI auto-compute |
| 11 | [applications-pipeline.md](11-applications-pipeline.md) | Application status transitions |

## Milestone 2 — Matching, Messaging, Notifications

| # | Doc | Purpose |
| - | --- | ------- |
| 12 | [matching-algorithm.md](12-matching-algorithm.md) | `scoreJob()` full spec + the 4 gaps to close |
| 13 | [pathway-assignment.md](13-pathway-assignment.md) | `calcPathway()` rules + recompute triggers |
| 14 | [interview-request-flow.md](14-interview-request-flow.md) | Request interview button → admin notification |
| 15 | [messaging-system.md](15-messaging-system.md) | Inbox + per-application threads |
| 16 | [email-notifications.md](16-email-notifications.md) | Resend edge function + 8 event triggers |
| 17 | [review-management.md](17-review-management.md) | Admin reviews CRUD + stats |
| 18 | [deployment-handoff.md](18-deployment-handoff.md) | Vercel deploy + docs to leave for the client |

## Reference

- [99-out-of-scope.md](99-out-of-scope.md) — what to push back to v2 if the client asks.
- `../CLAUDE.md` — frontend architecture notes (read this if you are touching `adventureexp_portal.html`).
- `../adventureexp_matchmaking_spec.docx` — authoritative spec for the matching algorithm.
- `../adventureexp_scope_v1.pdf` — original project scope.

## Non-negotiables (call these out in PR reviews)

1. **RLS** — participants must never see another participant's data. Test with two browser sessions before shipping any new table.
2. **CPI formula never leaves the server.** Participants see tier labels only. No formula in client JS.
3. **Match tags (Green/Yellow/Red)** — admin-only. The brief replaces this with sortable match scores in the admin participant list. Don't render colored tags to participants or employers.
4. **Pathway label** — participant-only. Never render in employer or admin-facing employer flows.
5. **Scores rank, never filter.** A Low match still appears in the list, just lower.
