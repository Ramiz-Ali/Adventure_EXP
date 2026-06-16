# lib/

Vanilla-JS modules that wire `adventureexp_portal.html` to Supabase. No build step. No bundler. Browser loads them as native ES modules.

## Files

| File | Exports | Purpose |
|---|---|---|
| `env.js` | `ENV` | Supabase URL + anon key. **Edit this before running.** |
| `supabase.js` | `sb` | Shared Supabase JS client. |
| `auth.js` | `signup`, `login`, `adminLogin`, `logout`, `getCurrentUser`, `fetchProfile`, `getCurrentSession`, `requestPasswordReset`, `setNewPassword`, `onAuthChange`, `mapAuthError` | Auth flows + session helpers. |
| `upload.js` | `uploadProfilePhoto`, `uploadEmployerPhoto`, `uploadHousingPhoto`, `removeEmployerPhoto`, `removeHousingPhoto` | Photo upload with resize + retry. |
| `db.js` | `hydrateAll`, `emptyPd`, `pdFromDb`, `pdToDb`, `jobFromDb`, `employerFromDb`, `studentFromDb`, `appFromDb`, `updateProfile`, `saveProgramProfile`, `toggleFavorite`, `createApplication`, `setApplicationStatus`, `listThread`, `sendMessage` | Fetches + column mapping + common writes. |
| `matching.js` | `scoreJob`, `calcPathway`, `matchLabel`, `matchColor`, `cpiLabel`, `topMatchScore` | Drop-in replacement for the in-HTML versions — closes the 4 spec gaps. |
| `notify.js` | `notify`, `listMyNotifications`, `unreadCount`, `markRead`, `markAllRead`, `getNotificationSettings`, `setNotificationSetting`, `subscribeToMyNotifications` | Notifications inbox + edge function calls. |

## Step 1 — Fill in `env.js`

Open `env.js`, replace `PASTE_YOUR_ANON_KEY_HERE` with your Supabase anon key (Settings → API Keys → anon public).

The URL is already filled in for your project. The anon key is public — safe to commit.

## Step 2 — Add the module bridge to `adventureexp_portal.html`

The existing portal script uses globals (no imports). The cleanest way to give it access to the modules is to put a small **module bridge** right before the existing `<script>` block at line ~300.

Find this in `adventureexp_portal.html`:
```html
<script>
var INDS=["hospitality","outdoor rec",...
```

Insert this **immediately above it**:

```html
<script type="module">
  import { sb } from './lib/supabase.js';
  import * as Auth from './lib/auth.js';
  import * as Upload from './lib/upload.js';
  import * as DB from './lib/db.js';
  import * as Match from './lib/matching.js';
  import * as Notify from './lib/notify.js';

  // Bridge to the legacy script which uses globals
  window.sb = sb;
  window.Auth = Auth;
  window.Upload = Upload;
  window.DB = DB;
  window.Match = Match;
  window.Notify = Notify;
</script>
```

Order matters: module scripts execute after classic scripts in source order, but `defer` semantics make them ready by the time the page's first interaction fires. To be safe, wait for the bridge to be ready in the legacy script:

```js
// At the very top of the existing <script> block:
function whenReady(fn) {
  if (window.DB) return fn();
  setTimeout(() => whenReady(fn), 10);
}
```

Then call `whenReady(boot)` at the bottom instead of `render()` directly.

## Step 3 — Replace the in-HTML functions

Inside the existing `<script>` block, find and replace:

### `login(email, password)` (around line 506)

Replace the in-memory lookup:
```js
async function login(email, password) {
  try {
    await Auth.login(email, password);
    currentUser = await Auth.getCurrentUser();
    await DB.hydrateAll({ currentUser, employers, jobs, students, apps, notifications });
    render();
  } catch (e) {
    document.getElementById('li-error').textContent = Auth.mapAuthError(e);
  }
}
```

### `scoreJob(j, p)` (around line 683) and `calcPathway(p)` (around line 728)

Delete the in-HTML versions. Use `Match.scoreJob(j, p)` and `Match.calcPathway(p)` everywhere instead — they fix the 4 spec gaps.

### `logout()` (around line 514)

```js
async function logout() {
  await Auth.logout();
  currentUser = null;
  authMode = 'login';
  signupPhoto = null;
  // wipe caches so a different user's session doesn't see stale rows
  employers.length = 0;
  jobs.length = 0;
  students.length = 0;
  apps.length = 0;
  render();
}
```

### Photo upload (around line 492)

```js
async function handlePhotoUpload(inp) {
  const key = inp.dataset.photo;
  const file = inp.files[0];
  if (!file) return;
  try {
    const url = await Upload.uploadProfilePhoto(file, currentUser.id);
    await DB.updateProfile(currentUser.id, { photo_url: url });
    currentUser.photo_url = url;
    const me = students.find(s => s.id === currentUser.id);
    if (me) me.photo = url;
    render();
  } catch (e) {
    alert('Upload failed: ' + e.message);
  }
}
```

### `reqInterview(jobId)` (currently in the click handler)

```js
async function reqInterview(jobId) {
  try {
    const app = await DB.createApplication(currentUser.id, jobId);
    Notify.notify('application_received', {
      application_id: app.id,
      job_title: app.job.title,
      employer_name: app.job.employer.name,
      participant_name: currentUser.first_name,
    });
    await DB.hydrateAll({ currentUser, employers, jobs, students, apps, notifications });
    render();
  } catch (e) {
    if (e.code === '23505') alert('You already applied to this job.');
    else alert('Could not submit. Try again.');
  }
}
```

### `toggleFav(jobId)`

```js
async function toggleFav(jobId) {
  const me = students.find(s => s.id === currentUser.id);
  const was = me.favorites.has(jobId);
  try {
    await DB.toggleFavorite(currentUser.id, jobId, was);
    if (was) me.favorites.delete(jobId);
    else me.favorites.add(jobId);
    render();
  } catch (e) { console.error(e); }
}
```

### Program profile saves (in the input/change handler around line 1645)

```js
// where the existing code does: s.pd[field] = val; render();
async function saveProgramField(field, val) {
  const me = students.find(s => s.id === currentUser.id);
  me.pd[field] = val;            // optimistic
  render();
  try {
    await DB.saveProgramProfile(currentUser.id, { [field]: val });
    // trigger updates profile_score + pathway. Re-fetch the profile:
    currentUser = await Auth.fetchProfile(currentUser.id);
    const fresh = DB.studentFromDb(currentUser);
    me.profileScore = fresh.profileScore;
    me.pathway = fresh.pathway;
    render();
  } catch (e) { console.error(e); }
}
```

### Boot (replace the trailing `render();` at line ~2220)

```js
async function boot() {
  const session = await Auth.getCurrentSession();
  if (!session) { render(); return; }
  currentUser = await Auth.fetchProfile(session.user.id);
  if (currentUser.role === 'admin') role = 'admin';
  await DB.hydrateAll({ currentUser, employers, jobs, students, apps, notifications });
  render();
}

Auth.onAuthChange(async (profile, event) => {
  if (!profile) { currentUser = null; render(); return; }
  currentUser = profile;
  await DB.hydrateAll({ currentUser, employers, jobs, students, apps, notifications });
  render();
});

whenReady(boot);
```

## Step 4 — Make the existing arrays mutable + globally visible

The existing HTML declares:
```js
var users = [...];
let employers = [...];
let jobs = [...];
let students = [...];
let apps = [...];
```

**Change them to empty arrays** (the seed data moves to Supabase) and make sure they're `var` or attached to `window` so `DB.hydrateAll` can find them:

```js
var users = [];            // unused after auth migration — keep as empty
var employers = [];
var jobs = [];
var students = [];
var apps = [];
var notifications = [];    // new — was not in the original
var currentUser = null;
```

Also drop the demo seed data (the long employer/job/student literals between lines 335–375).

## Common pattern — write, then re-hydrate

Every mutation follows the same shape:

```js
await DB.someWrite(...);
await DB.hydrateAll({ currentUser, employers, jobs, students, apps, notifications });
render();
```

For high-frequency clicks (favorite toggle, chip toggle), do an optimistic local update first and skip the full hydrate.

## Testing checklist

- [ ] `env.js` filled in.
- [ ] Module bridge inserted into the HTML.
- [ ] `whenReady` guard wraps `boot`.
- [ ] Existing seed arrays emptied.
- [ ] Sign up a new participant → row appears in `profiles` table.
- [ ] Login persists across reload.
- [ ] Logout clears all cached arrays.
- [ ] `Match.scoreJob` and `Match.calcPathway` replace the in-HTML versions.
- [ ] Pick a job, click "Request Interview" → application row appears.
- [ ] Refresh the page → application still there.
