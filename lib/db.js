// Data hydration + DB-column ↔ frontend-field mapping.
//
// The existing portal uses camelCase field names (`startDate`, `jobRoles`, etc.)
// and the DB uses snake_case (`start_date`, `job_roles`). This module owns the
// translation in both directions so the render code never sees DB column names.

import { sb } from './supabase.js?v=14';

// ============================================================================
// Program profile (the 6-section matchmaking questionnaire)
// ============================================================================

export function emptyPd() {
  return {
    startDate: '', endDate: '', minDuration: '', flex: '',
    license: '', passport: '', car: '',
    roles: [], avoidText: '', priority: '',
    envs: [], housingPref: '', recImportance: '', hobbies: [],
    finGoal: '', savings: '', income: '',
    altOpen: '', mindset: '',
    extraNotes: '', successMeaning: '',
  };
}

const PD_DB_TO_FE = {
  start_date: 'startDate',
  end_date: 'endDate',
  min_duration: 'minDuration',
  flex: 'flex',
  license: 'license',
  passport: 'passport',
  car: 'car',
  roles: 'roles',
  avoid_text: 'avoidText',
  priority: 'priority',
  envs: 'envs',
  housing_pref: 'housingPref',
  rec_importance: 'recImportance',
  hobbies: 'hobbies',
  fin_goal: 'finGoal',
  savings: 'savings',
  income: 'income',
  alt_open: 'altOpen',
  mindset: 'mindset',
  extra_notes: 'extraNotes',
  success_meaning: 'successMeaning',
};

const PD_FE_TO_DB = Object.fromEntries(
  Object.entries(PD_DB_TO_FE).map(([db, fe]) => [fe, db])
);

export function pdFromDb(row) {
  const out = emptyPd();
  if (!row) return out;
  for (const [db, fe] of Object.entries(PD_DB_TO_FE)) {
    if (row[db] != null) out[fe] = row[db];
  }
  // Not a form field — carried through so the client can fire the "profile
  // completed" email exactly once (see markProgramComplete + flushProgramSave).
  out.completedAt = row.completed_at || '';
  return out;
}

export function pdToDb(patch) {
  const out = {};
  for (const [fe, val] of Object.entries(patch)) {
    if (PD_FE_TO_DB[fe] !== undefined) {
      // Un-filled fields arrive as '' but the DB columns are enum-CHECKed
      // (flex/min_duration/…) or `date` typed — '' fails those constraints and
      // rejects the whole upsert, so a partial profile never saves. Store NULL
      // instead: NULL passes CHECK constraints and is valid for date columns.
      out[PD_FE_TO_DB[fe]] = (val === '' ? null : val);
    }
  }
  return out;
}

// ============================================================================
// Row → frontend object mappers
// ============================================================================

export function jobFromDb(j) {
  return {
    id: j.id,
    empId: j.employer_id,
    title: j.title,
    description: j.description || '',
    pay: payDisplay(j.pay_rate, j.pay_rate_max, '/hr'),
    salaryDisplay: payDisplay(j.pay_rate, j.pay_rate_max, ' / Hourly'),
    payMin: j.pay_rate,
    payMax: j.pay_rate_max || null,
    hrs: j.hours_per_week,
    season: j.season,
    startMonth: j.start_month,
    endMonth: j.end_month,
    start: j.start_date,
    end: j.end_date,
    duration: estimateDurationMonths(j),
    status: j.status,
    archived: !!j.archived,
    cpi: j.cpi,
    experience: j.experience,
    type: j.title,
    env: j.env,
    envs: (j.envs && j.envs.length) ? j.envs : (j.env ? [j.env] : []),
    age21: !!j.age_21,
    socialEnergy: j.social_energy || '',
    nightlife: j.nightlife || '',
    jobRoles: j.job_roles || [],
    hobbies: j.hobbies || [],
    savingsLevel: j.savings_level,
    housing: {
      type: j.housing_type || '',
      cost: payDisplay(j.housing_cost, j.housing_cost_max, '/mo') || (j.housing_type ? 'included' : ''),
      costMin: j.housing_cost || 0,
      costMax: j.housing_cost_max || null,
      meals: j.meals || '',
    },
    requirements: j.qualifications || '',
    perks: [], // populated from employer or computed
    slots: j.positions,
    filled: j.filled || 0,
    overtime: false,
    requiresLicense: j.requires_license,
    requiresPassport: j.requires_passport,
    requiresVehicle: !!j.requires_vehicle, // v2 M3 1.6
    isTipped: j.is_tipped,
  };
}

// Render a value or a "min – max" range with a $ prefix. Returns '' when both
// are empty. Used for pay rate and housing cost.
function payDisplay(min, max, suffix) {
  const lo = (min || min === 0) ? Number(min) : null;
  const hi = (max || max === 0) ? Number(max) : null;
  if (lo == null && hi == null) return '';
  // Whole dollars show plain ($16); cents show two decimals ($15.10, not $15.1).
  const fmt = (n) => Number.isInteger(n) ? String(n) : n.toFixed(2);
  if (hi != null && hi > (lo || 0)) return `$${fmt(lo || 0)}–${fmt(hi)}${suffix}`;
  return `$${fmt(lo || 0)}${suffix}`;
}

// Age from a birthdate (yyyy-mm-dd). Null if no birthdate.
function ageFromBirthdate(b) {
  if (!b) return null;
  const d = new Date(b);
  if (isNaN(d)) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 120 ? age : null;
}

function estimateDurationMonths(j) {
  if (!j.start_date || !j.end_date) return '';
  const a = new Date(j.start_date);
  const b = new Date(j.end_date);
  const months = Math.round((b - a) / (1000 * 60 * 60 * 24 * 30));
  return months > 0 ? `${months} months` : '';
}

export function employerFromDb(e) {
  // DB booleans (true/false/null) -> the 'yes'/'no'/'' the radio groups expect.
  const ynBool = (v) => v === true ? 'yes' : v === false ? 'no' : '';
  return {
    id: e.id,
    name: e.name,
    logo: '🏢',                   // emoji fallback — used by every row renderer
    logoUrl: e.logo_url || '',    // real uploaded URL, rendered as <img> when set
    industry: e.industry || '',
    region: e.region || `${e.city || ''}${e.state ? ', ' + e.state : ''}`,
    state: e.state || '',
    seasons: e.seasons || [],
    desc: e.description || '',
    lifestyle: [],
    verified: !!e.verified,
    archived: !!e.archived,
    housing: e.housing_desc ? 'provided' : '',
    perks: [],
    savedCandidates: [],
    placements: 0,
    reviews: [],
    photos: e.photos || [],
    // Admin "Edit Employer" form fields. employerFromDb previously dropped
    // these, so the form reloaded blank for everything except name/description
    // even though the row saved fine. Map every column the form reads back.
    contactName: e.contact_name || '',
    contactTitle: e.contact_title || '',
    contactEmail: e.email || '',
    contactPhone: e.phone || '',
    website: e.website || '',
    address: e.address || '',
    city: e.city || '',
    zip: e.zip || '',
    employees: e.employee_count != null ? e.employee_count : '',
    airport: e.nearest_airport || '',
    transAvail: e.transportation || '',
    benefits: e.benefits || '',
    payPeriod: e.pay_frequency || '',
    drugTest: ynBool(e.drug_testing),
    intConductor: e.interview_contact || '',
    intFormat: e.interview_method || '',
    housingSetup: e.housing_desc || '',
    housingCost: e.housing_cost != null ? String(e.housing_cost) : '',
    housingIncluded: (e.housing_inclusions || '').split(',').map((s) => s.trim()).filter(Boolean),
    housingCoed: ynBool(e.housing_coed),
    housingBedrooms: e.housing_bedrooms != null ? e.housing_bedrooms : '',
    housingBedsPer: e.housing_beds_per_room != null ? String(e.housing_beds_per_room) : '',
    housingKitchen: ynBool(e.housing_kitchen),
    housingAddress: e.housing_address || '',
    housingDeposit: e.housing_deposit != null ? String(e.housing_deposit) : '',
    housingDepRefundable: e.housing_refund_policy || '',
    housingPicsLater: ynBool(e.housing_pics_later),
    startMonth: e.hiring_start_month || '',
    endMonth: e.hiring_end_month || '',
    raw: e, // keep raw for admin edit forms
  };
}

export function studentFromDb(p) {
  const fav = new Set();
  return {
    id: p.id,
    name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || (p.email || 'Participant'),
    firstName: p.first_name || '',
    lastName: p.last_name || '',
    email: p.email,
    birthdate: p.birthdate || '',
    age: ageFromBirthdate(p.birthdate) ?? p.age ?? null,
    location: p.location || '',
    eligibility: 'US citizen',
    bio: p.bio || '',
    availability: { start: '', end: '' },
    availTimes: p.avail_times || [],
    availDays: p.avail_days || [],
    timezone: p.timezone || '',
    seasons: [],
    industries: p.industry_interests || [],
    skills: p.skills || '',
    languages: ['English'],
    housingNeeds: '',
    profileScore: p.profile_score || 0,
    visibility: p.visibility !== false,
    courses: [],
    notes: p.admin_notes || '',
    lastLogin: p.last_login || null,
    favorites: fav,
    sector: '',
    approved: !!p.approved,
    pathway: p.pathway || '',
    photo: p.photo_url || null,
    role: p.role,
    requestsBlocked: !!p.requests_blocked, // v2 M3 3.2
    requestsOpened: !!p.requests_opened,   // v2 M2 finalization — coordinator override
    suspended: !!p.suspended,              // v2 M3 3.2
    pd: pdFromDb(p.program_profile),
    raw: p,
  };
}

export function reviewFromDb(r) {
  return {
    id: r.id,
    studentName: r.participant_name || 'Anonymous',
    participantId: r.participant_id,
    empId: r.employer_id,
    jobId: r.job_id,
    rating: r.rating,
    text: r.comments || '',
    date: (r.created_at || '').slice(0, 10),
  };
}

export function appFromDb(a) {
  // a.messages is an array of {id} stubs from the count-only sub-select.
  // We pre-populate it so the "Messages (n)" counter on the Applied list
  // shows the real count without opening the thread first. The actual
  // message bodies are loaded lazily when the user opens the thread.
  var msgs = Array.isArray(a.messages) ? a.messages : [];
  return {
    id: a.id,
    studentId: a.participant_id,
    jobId: a.job_id,
    status: a.status,
    date: (a.created_at || '').slice(0, 10),
    adminRemovedAt: a.admin_removed_at || null, // soft-removed from the job side (1.8)
    messageCount: msgs.length,
    messages: msgs, // stubs only — replaced with full rows on thread open
  };
}

// App settings — login-page notice (v2 M3). Publicly readable (pre-auth login page).
export async function getAppSettings() {
  const { data, error } = await sb.from('app_settings').select('*').eq('id', 1).maybeSingle();
  if (error) { console.error('getAppSettings', error); return null; }
  return data;
}
export async function updateLoginNotice({ enabled, text }) {
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('app_settings').update({
    login_notice_enabled: !!enabled,
    login_notice_text: text || null,
    updated_at: new Date().toISOString(),
    updated_by: user ? user.id : null,
  }).eq('id', 1);
  if (error) throw error;
}

// Manual placement (v2 M2 3.4): an off-portal hire recorded by an admin.
export function manualPlacementFromDb(m) {
  return {
    id: m.id,
    participantId: m.participant_id,
    employerName: m.employer_name || '',
    roleTitle: m.role_title || '',
    startDate: m.start_date || '',
    endDate: m.end_date || '',
    notes: m.notes || '',
    createdAt: m.created_at,
  };
}

// Coordinator match (v2 M2 2.2): an admin-flagged job for a participant.
export function coordMatchFromDb(m) {
  return {
    id: m.id,
    participantId: m.participant_id,
    jobId: m.job_id,
    note: m.note || '',
    createdAt: m.created_at,
  };
}

// ============================================================================
// Hydration
// ============================================================================

function replaceArr(target, items) {
  target.length = 0;
  target.push(...items);
}

/**
 * Re-fetch all the data the UI reads from. Mutates the passed arrays in place
 * so the existing `let employers = [...]` etc. in the HTML pick up the changes.
 *
 * @param {Object} g - globals
 * @param {Object} g.currentUser - the resolved profile (or null)
 * @param {Array}  g.employers
 * @param {Array}  g.jobs
 * @param {Array}  g.students
 * @param {Array}  g.apps
 * @param {Array}  g.notifications
 */
export async function hydrateAll(g) {
  if (!g.currentUser) return;
  const isAdmin = g.currentUser.role === 'admin';

  // Every list query is explicitly ordered by created_at. Without an ORDER BY,
  // Postgres returns rows in physical order, which changes after an UPDATE — so
  // the row an admin just edited would jump to the bottom of the list. Ordering
  // by creation time keeps the list stable across edits.
  const queries = [
    sb.from('employers').select('*').order('created_at', { ascending: true }),
    sb.from('jobs').select('*').order('created_at', { ascending: true }),
    isAdmin
      ? sb.from('profiles').select('*, program_profile(*)').order('created_at', { ascending: true })
      : sb.from('profiles').select('*, program_profile(*)').eq('id', g.currentUser.id),
    isAdmin
      ? sb.from('applications').select('*, messages(id)').order('created_at', { ascending: true })
      : sb.from('applications').select('*, messages(id)').eq('participant_id', g.currentUser.id).order('created_at', { ascending: true }),
    // Fetch the inbox in the same shape the bell dropdown shows (all
    // notifications, newest first, capped). Filtering to `is('read_at', null)`
    // here used to wipe just-read notifications out of memory whenever a
    // realtime event re-ran hydrateAll, even though they were still in the DB
    // — the bell then went blank until the user opened it (which separately
    // calls listMyNotifications and fetches the full list).
    sb.from('notifications').select('*').eq('recipient_id', g.currentUser.id).order('created_at', { ascending: false }).limit(50),
    isAdmin
      ? sb.from('favorites').select('*')
      : sb.from('favorites').select('*').eq('participant_id', g.currentUser.id),
    sb.from('reviews').select('*').order('created_at', { ascending: false }),
    isAdmin
      ? sb.from('coordinator_matches').select('*').order('created_at', { ascending: false })
      : sb.from('coordinator_matches').select('*').eq('participant_id', g.currentUser.id).order('created_at', { ascending: false }),
    isAdmin
      ? sb.from('manual_placements').select('*').order('created_at', { ascending: false })
      : sb.from('manual_placements').select('*').eq('participant_id', g.currentUser.id).order('created_at', { ascending: false }),
  ];

  const [emps, js, ps, as, ns, favs, revs, cms, mps] = await Promise.all(queries);

  if (g.employers)     replaceArr(g.employers, (emps.data || []).map(employerFromDb));
  if (g.jobs)          replaceArr(g.jobs, (js.data || []).map(jobFromDb));
  if (g.students)      replaceArr(g.students, (ps.data || []).map(studentFromDb));
  if (g.apps)          replaceArr(g.apps, (as.data || []).map(appFromDb));
  if (g.allApps)       replaceArr(g.allApps, (as.data || []).map(appFromDb));
  if (g.notifications) replaceArr(g.notifications, ns.data || []);
  if (g.reviews)       replaceArr(g.reviews, (revs.data || []).map(reviewFromDb));
  if (g.coordMatches)  replaceArr(g.coordMatches, (cms.data || []).map(coordMatchFromDb));
  if (g.manualPlacements) replaceArr(g.manualPlacements, (mps.data || []).map(manualPlacementFromDb));

  // Attach each participant's favorites Set. For a participant this is only
  // their own row (RLS + query filter); for an admin it's every participant's
  // (favorites_select_admin policy) — so the admin view can show what each has
  // starred (v2 M1 item 1.1).
  const favByUser = new Map();
  for (const f of (favs.data || [])) {
    if (!favByUser.has(f.participant_id)) favByUser.set(f.participant_id, new Set());
    favByUser.get(f.participant_id).add(f.job_id);
  }
  if (g.students) {
    for (const s of g.students) {
      s.favorites = favByUser.get(s.id) || new Set();
    }
  }
}

// ============================================================================
// Common write helpers
// ============================================================================

export async function updateProfile(userId, patch) {
  const { error } = await sb.from('profiles').update(patch).eq('id', userId);
  if (error) throw error;
}

// Coordinator match (v2 M2 2.2): admin flags a job for a participant. Admin-only
// via RLS. The DB trigger notifies the participant (row → email).
export async function createCoordinatorMatch(participantId, jobId, note) {
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('coordinator_matches').insert({
    participant_id: participantId,
    job_id: jobId,
    note: note || null,
    created_by: user ? user.id : null,
  });
  if (error) throw error;
}
export async function removeCoordinatorMatch(id) {
  const { error } = await sb.from('coordinator_matches').delete().eq('id', id);
  if (error) throw error;
}

// Manual placement (v2 M2 3.4): record an off-portal hire. Admin-only via RLS.
export async function createManualPlacement(participantId, fields) {
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('manual_placements').insert({
    participant_id: participantId,
    employer_name: fields.employerName,
    role_title: fields.roleTitle || null,
    start_date: fields.startDate || null,
    end_date: fields.endDate || null,
    notes: fields.notes || null,
    created_by: user ? user.id : null,
  });
  if (error) throw error;
}
// Edit an existing off-portal placement (v2 M2 feedback 3 — placements are now
// editable, not only removable).
export async function updateManualPlacement(id, fields) {
  const { error } = await sb.from('manual_placements').update({
    employer_name: fields.employerName,
    role_title: fields.roleTitle || null,
    start_date: fields.startDate || null,
    end_date: fields.endDate || null,
    notes: fields.notes || null,
  }).eq('id', id);
  if (error) throw error;
}
export async function removeManualPlacement(id) {
  const { error } = await sb.from('manual_placements').delete().eq('id', id);
  if (error) throw error;
}

// Soft-remove an application from the job/employer side (v2 M1 1.8). Admin-only
// via applications_update_admin RLS. Restores by clearing the timestamp. The row
// is never deleted, so the participant's history stays intact.
export async function adminRemoveApplication(appId) {
  const { error } = await sb.from('applications')
    .update({ admin_removed_at: new Date().toISOString() }).eq('id', appId);
  if (error) throw error;
}
export async function adminRestoreApplication(appId) {
  const { error } = await sb.from('applications')
    .update({ admin_removed_at: null }).eq('id', appId);
  if (error) throw error;
}

export async function saveProgramProfile(userId, patch) {
  const dbPatch = pdToDb(patch);
  const { error } = await sb
    .from('program_profile')
    .upsert({ user_id: userId, ...dbPatch });
  if (error) throw error;
}

// Stamp completed_at the first time a participant finishes their match profile.
// The `.is('completed_at', null)` guard makes it idempotent — a second call (or a
// race between two saves) is a no-op, so the team is emailed exactly once.
export async function markProgramComplete(userId) {
  const { error } = await sb
    .from('program_profile')
    .update({ completed_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('completed_at', null);
  if (error) throw error;
}

export async function toggleFavorite(userId, jobId, currentlyOn) {
  if (currentlyOn) {
    const { error } = await sb.from('favorites').delete()
      .match({ participant_id: userId, job_id: jobId });
    if (error) throw error;
  } else {
    const { error } = await sb.from('favorites').insert({
      participant_id: userId,
      job_id: jobId,
    });
    if (error) throw error;
  }
}

export async function createApplication(userId, jobId) {
  const { data, error } = await sb
    .from('applications')
    .insert({ participant_id: userId, job_id: jobId, status: 'requested' })
    .select(`id, status, job:jobs(title, employer:employers(name))`)
    .single();
  if (error) throw error;
  return data;
}

export async function setApplicationStatus(appId, status) {
  if (status === 'placed') {
    const { error } = await sb.rpc('place_application', { app_id: appId });
    if (error) throw error;
    return;
  }
  const { error } = await sb.from('applications').update({ status }).eq('id', appId);
  if (error) throw error;
}

export async function listThread(applicationId) {
  const { data, error } = await sb
    .from('messages')
    .select('*, sender:profiles(id, first_name, last_name, photo_url, role)')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function sendMessage(applicationId, senderId, body) {
  const { data, error } = await sb
    .from('messages')
    .insert({ application_id: applicationId, sender_id: senderId, body })
    .select()
    .single();
  if (error) throw error;
  return data;
}
