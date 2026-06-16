# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The **AdventureEXP Work Portal** — a seasonal-jobs matchmaking site that ranks (does not filter) job listings against participant ("student") profiles using a 5-category scoring formula. Three role-based UIs (participant / employer / admin) share the same page.

It started as a single-file HTML/CSS/JS prototype. Backend wiring (Supabase Auth + Postgres + Storage) is now live via the `lib/` ES modules — the prototype's in-memory seeds have been replaced with real fetches. No bundler, no framework; the browser loads everything as native modules.

Layout:

- `adventureexp_portal.html` — the entire UI (HTML, inline CSS, inline JS, base64-embedded logo). ~2,450 lines. Loads `lib/*.js` as ES modules and bridges them onto `window.*` for the legacy script.
- `lib/` — ES modules wiring the UI to Supabase: `env.js`, `supabase.js`, `auth.js`, `db.js`, `matching.js`, `upload.js`, `notify.js`. See `lib/README.md` for the contract between modules and the legacy script.
- `supabase/migrations/0001_init.sql` — full schema + RLS policies. Apply this to a fresh Supabase project to bootstrap the backend.
- `docs/` — 21 milestone-by-milestone implementation guides (README + 00–18 + 99). Read `docs/README.md` first when starting any backend feature.
- `dev-server.py` — no-cache static server that rewrites every `import './foo.js'` into `./foo.js?v=<mtime>` to defeat Chrome's stubborn ES-module cache. **Use this, not `python3 -m http.server`.**
- `adventureexp_matchmaking_spec.docx` — authoritative spec for the matchmaking formula.
- `adventureexp_scope_v1.pdf` — project scope.
- `.env.local` — Supabase keys (gitignored). The anon key in `lib/env.js` is also committed and is safe to ship — it is paired with RLS. **Never** put the service-role key in `lib/`.

## Run / inspect

- **Run the app**: `python3 dev-server.py` from the project root, then open `http://localhost:8000/adventureexp_portal.html`. Opening the file directly (`file://`) breaks ES-module imports.
- **Read the spec as plain text**: `unzip -p adventureexp_matchmaking_spec.docx word/document.xml | sed 's/<[^>]*>/ /g' | tr -s ' \n' ' '`
- **Apply schema to a fresh Supabase project**: paste `supabase/migrations/0001_init.sql` into the SQL editor. No Supabase CLI in use.
- **Auth**: sign up via the UI (Supabase creates the `profiles` row via trigger). Admin login uses a separate flow gated by `authMode === "admin-login"` and the `profiles.role = 'admin'` column. The old in-memory `users` array is gone — do not add demo logins back.

## Architecture

The UI is one large `<script>` block at the bottom of the HTML using vanilla JS, global mutable state, and full-tree re-render on every interaction. Above it sits a small `<script type="module">` bridge (line ~305) that imports `lib/*.js` and attaches `sb`, `Auth`, `Upload`, `DB`, `Match`, `Notify` to `window` so the legacy script can call them.

### The module bridge — load order matters

Module scripts execute after the classic `<script>` parses but before it runs (defer semantics). The legacy code still guards every backend call with `window.DB && …` or `window.Auth && …` because the boot path waits for the bridge to be present. **Do not delete those guards**, and do not re-attach the same imports inline — there should be exactly one bridge.

When you add a new lib export, you must also extend the bridge to expose it on the matching `window.*` namespace; otherwise the legacy script can't see it.

### State model

Top-level `var`/`let` globals (no encapsulation):

- **In-memory caches** (line ~348, now declared empty): `users`, `employers`, `jobs`, `students`, `apps`, `notifications`. Populated by `DB.hydrateAll(...)` after login. The legacy code reads from these arrays — `hydrateAll` mutates them in place, it doesn't return new arrays.
- **UI state**: `role` ("student" | "employer" | "admin"), `studentView`, `empView`, `adminView`, `detailJobId`, filter sets (`filterSeason`, `filterMonth`, `filterRegion`, `filterActivity`, `filterCPI`), `currentUser`, `authMode`, plus `window._*` slots (`window._pTab`, `window._jobEmpId`, `window._starRating`, etc.) used as ad-hoc context for tabs and forms.

### Render loop

`render()` (line ~808) rebuilds `#main.innerHTML` by calling one of `rStudent()` / `rEmployer()` / `rAdmin()`, which in turn switches on the per-role view state to call sub-renderers (`rDashboard`, `rDiscover`, `rListings`, `rJobDetail`, `rApplied`, `rProfile`, `rMatchIntake`, `rLiveMatch`, `rMsgs`, `rEmpList`, `rEmpCand`, `rAdmOv`, `rAdmStu`, `rAdmEmp`, `rAdmApp`, `rAdmReviews`, `rAdmEmpForm`, `rAdmJobForm`, …). Render functions return HTML strings built by concatenation.

**Convention for mutations**: `await DB.someWrite(...)` → `await DB.hydrateAll({...})` → `render()`. For high-frequency clicks (favorite toggle, chip toggle), do an optimistic local mutation first and skip the full re-hydrate. There is no diffing — the entire view re-renders.

### Event wiring (`data-action` dispatch)

A single delegated handler at `document.addEventListener('click', …)` (line ~375) reads `data-action`, `data-id`, `data-id2`, `data-val` off the clicked element (or its closest ancestor) and dispatches via a long `if/else if` chain. ~40 verbs in use, including: `nav`, `empnav`, `adminnav`, `detail`, `back`, `fav`, `apply`, `accept`, `decline`, `sendmsg`, `ptab`, `setstatus`, `empaccept`/`empdecline`/`empoffer`, `verify`, `matchjobs`, `adminplace`, `editprofile`, `saveprofile`, `addemp`/`editemp`/`saveemp`, `addjob`/`editjob`/`savejob`, `addstudent`/`editstudent`/`savestudent`, `chip`, `radio`, `clr*` (filter clears).

**To add a new interaction**: emit `data-action="<verb>" data-id="..." data-val="..."` on the element, then add an `else if (a === '<verb>')` branch in the handler. Don't attach inline `onclick` — it bypasses the dispatch convention.

Form inputs use a parallel `data-upd="<field>"` convention handled by the `input`/`change` listener, and `data-photo` + `data-suphotoinp` for FileReader photo uploads. Photos go through `Upload.upload*Photo(...)` (Supabase Storage with resize + retry), not the old `photoStore` in-memory map.

### Lookup helpers

`E(id)`, `J(id)`, `S(id)` find employer/job/student by id. `bdg(text, class)`, `cpiC(v)`, `mColor(s)`, `mLabel(s)` produce small UI fragments. Class names are deliberately terse (`lr`, `lb2`, `sc`, `cpih`, `mb`, `mf`, `bdg`, `bt`/`ba`/`bc`/`bb`/`bp`/`bg` for badge colors) — match the existing style when adding markup.

## Matchmaking — read the spec before changing this

The scoring logic is the product. Two implementations exist:

- `lib/matching.js` (`Match.scoreJob`, `Match.calcPathway`) — the **canonical** version, designed to close the 4 spec gaps.
- In-HTML `scoreJob(j, p)` (line ~730) and `calcPathway(p)` (line ~744) — wrappers that delegate to `window.Match.*` when present and fall back to an inline copy otherwise. Treat the inline copy as a stub: changes belong in `lib/matching.js`.

Both return `{ overall: 0–100, cats: [timing, fin, role, life, flex] }` and a pathway in: *High Earner*, *Adventure Seeker*, *Structured Achiever*, *Mountain Pursuer*, *Coastal Explorer*, *Explorer* (default).

Defaults:

- Weights: `[0.30, 0.25, 0.20, 0.15, 0.10]` for Timing / Financial / Role / Lifestyle / Flexibility, shifted when `p.priority` is `"role"` or `"location"`.
- Display labels: ≥75 *Strong*, ≥55 *Good*, ≥35 *Partial*, else *Low*.

**Implementation gaps vs. spec** (called out at the end of `adventureexp_matchmaking_spec.docx` and in `docs/12-matching-algorithm.md` — confirm before claiming a behavior is correct):

1. Dynamic weight shifting by `priority` — partial; "balanced" defaults match, "role"/"location" deviate slightly from the spec's intended values.
2. Logistics modifiers in Timing — license/passport `-15`/`-10` not yet applied.
3. Housing preference modifier in Lifestyle — not yet applied.
4. Admin-only match tags (Green / Yellow / Red) — not yet computed or rendered.

## Domain rules that affect what is allowed to render

These come from `adventureexp_matchmaking_spec.docx` §11 and are easy to violate by accident — check before adding any new UI surface:

- **Scores rank, never filter.** A "Low match" job must still appear in the list, just lower.
- **Never show participants** the raw formula, the weight percentages, or the CPI numeric formula. Show the score percentage with label, the per-category breakdown, the pathway badge, and the CPI **tier badge** (🔵 ≥10, 🟢 8–9.9, 🟡 6–7.9, 🔴 <6) only.
- **Pathway is participant-facing only.** Never render it in employer views.
- **Match tags (Green/Yellow/Red) are admin-only.** Never render them to participants or employers.

## Things worth knowing before editing

- **Adding a profile field** now touches three places: (a) the SQL column + migration in `supabase/migrations/`, (b) the `pdFromDb` / `pdToDb` mappers in `lib/db.js`, (c) the form in `rMatchIntake` plus any scoring use in `lib/matching.js`. The trigger that recomputes `profile_score` and `pathway` on profile save lives in the migration — extending the formula means updating both `lib/matching.js` *and* the SQL trigger.
- **RLS is the enforcement layer.** Participants must never see another participant's data — test any new table with two browser sessions before shipping. The anon key in `lib/env.js` is browser-safe *only* because RLS is correct.
- **CPI formula stays server-side.** Participants see the tier badge only (🔵 ≥10, 🟢 8–9.9, 🟡 6–7.9, 🔴 <6). Don't compute or display the raw CPI number in client JS.
- **The CSS uses CSS variables** defined in `:root` (line ~10) for the entire color system (`--or`, `--re`, `--bl`, `--kh`, `--lb`, `--bg`, `--sur`, `--tx`, `--mu`, …). Use the variables rather than literal hex values.
- **The brand logo** is a base64 PNG inlined into the HTML — large but intentional, don't strip it.
- **Don't go around the bridge.** New backend calls should go through a `lib/*.js` export and be reached via `window.DB.*` / `window.Auth.*` / etc. — not inline `sb.from(...)` calls in the HTML — so the contract between modules and the legacy script stays in one place.
