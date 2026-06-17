// Data hydration + DB-column ↔ frontend-field mapping.
//
// The existing portal uses camelCase field names (`startDate`, `jobRoles`, etc.)
// and the DB uses snake_case (`start_date`, `job_roles`). This module owns the
// translation in both directions so the render code never sees DB column names.

import { sb } from './supabase.js';

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
  return out;
}

export function pdToDb(patch) {
  const out = {};
  for (const [fe, val] of Object.entries(patch)) {
    if (PD_FE_TO_DB[fe] !== undefined) out[PD_FE_TO_DB[fe]] = val;
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
    pay: j.pay_rate ? `$${j.pay_rate}/hr` : '',
    salaryDisplay: j.pay_rate ? `$${j.pay_rate} / Hourly` : '',
    hrs: j.hours_per_week,
    season: j.season,
    startMonth: j.start_month,
    endMonth: j.end_month,
    start: j.start_date,
    end: j.end_date,
    duration: estimateDurationMonths(j),
    status: j.status,
    cpi: j.cpi,
    experience: j.experience,
    type: j.title,
    env: j.env,
    jobRoles: j.job_roles || [],
    hobbies: j.hobbies || [],
    savingsLevel: j.savings_level,
    housing: {
      type: j.housing_type || '',
      cost: j.housing_cost ? `$${j.housing_cost}/mo` : (j.housing_type ? 'included' : ''),
      meals: j.meals || '',
    },
    requirements: j.qualifications || '',
    perks: [], // populated from employer or computed
    slots: j.positions,
    filled: j.filled || 0,
    overtime: false,
    requiresLicense: j.requires_license,
    requiresPassport: j.requires_passport,
    isTipped: j.is_tipped,
  };
}

function estimateDurationMonths(j) {
  if (!j.start_date || !j.end_date) return '';
  const a = new Date(j.start_date);
  const b = new Date(j.end_date);
  const months = Math.round((b - a) / (1000 * 60 * 60 * 24 * 30));
  return months > 0 ? `${months} months` : '';
}

export function employerFromDb(e) {
  return {
    id: e.id,
    name: e.name,
    logo: '🏢',                   // emoji fallback — used by every row renderer
    logoUrl: e.logo_url || '',    // real uploaded URL, rendered as <img> when set
    industry: e.industry || '',
    region: e.region || `${e.city || ''}${e.state ? ', ' + e.state : ''}`,
    state: e.state || '',
    seasons: [],
    desc: e.description || '',
    lifestyle: [],
    verified: !!e.verified,
    housing: e.housing_desc ? 'provided' : '',
    perks: [],
    savedCandidates: [],
    placements: 0,
    reviews: [],
    photos: e.photos || [],
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
    age: p.age,
    location: p.location || '',
    eligibility: 'US citizen',
    bio: p.bio || '',
    availability: { start: '', end: '' },
    seasons: [],
    destinations: [],
    industries: [],
    skills: '',
    languages: ['English'],
    housingNeeds: '',
    profileScore: p.profile_score || 0,
    visibility: p.visibility !== false,
    courses: [],
    notes: p.admin_notes || '',
    favorites: fav,
    sector: '',
    approved: !!p.approved,
    pathway: p.pathway || '',
    photo: p.photo_url || null,
    role: p.role,
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
    messageCount: msgs.length,
    messages: msgs, // stubs only — replaced with full rows on thread open
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

  const queries = [
    sb.from('employers').select('*'),
    sb.from('jobs').select('*'),
    isAdmin
      ? sb.from('profiles').select('*, program_profile(*)')
      : sb.from('profiles').select('*, program_profile(*)').eq('id', g.currentUser.id),
    isAdmin
      ? sb.from('applications').select('*, messages(id)')
      : sb.from('applications').select('*, messages(id)').eq('participant_id', g.currentUser.id),
    // Fetch the inbox in the same shape the bell dropdown shows (all
    // notifications, newest first, capped). Filtering to `is('read_at', null)`
    // here used to wipe just-read notifications out of memory whenever a
    // realtime event re-ran hydrateAll, even though they were still in the DB
    // — the bell then went blank until the user opened it (which separately
    // calls listMyNotifications and fetches the full list).
    sb.from('notifications').select('*').eq('recipient_id', g.currentUser.id).order('created_at', { ascending: false }).limit(50),
    sb.from('favorites').select('*').eq('participant_id', g.currentUser.id),
    sb.from('reviews').select('*').order('created_at', { ascending: false }),
  ];

  const [emps, js, ps, as, ns, favs, revs] = await Promise.all(queries);

  if (g.employers)     replaceArr(g.employers, (emps.data || []).map(employerFromDb));
  if (g.jobs)          replaceArr(g.jobs, (js.data || []).map(jobFromDb));
  if (g.students)      replaceArr(g.students, (ps.data || []).map(studentFromDb));
  if (g.apps)          replaceArr(g.apps, (as.data || []).map(appFromDb));
  if (g.allApps)       replaceArr(g.allApps, (as.data || []).map(appFromDb));
  if (g.notifications) replaceArr(g.notifications, ns.data || []);
  if (g.reviews)       replaceArr(g.reviews, (revs.data || []).map(reviewFromDb));

  // attach favorites Set to the current participant's student row
  const favSet = new Set((favs.data || []).map(f => f.job_id));
  const me = g.students?.find(s => s.id === g.currentUser.id);
  if (me) me.favorites = favSet;
}

// ============================================================================
// Common write helpers
// ============================================================================

export async function updateProfile(userId, patch) {
  const { error } = await sb.from('profiles').update(patch).eq('id', userId);
  if (error) throw error;
}

export async function saveProgramProfile(userId, patch) {
  const dbPatch = pdToDb(patch);
  const { error } = await sb
    .from('program_profile')
    .upsert({ user_id: userId, ...dbPatch });
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
    .insert({ participant_id: userId, job_id: jobId, status: 'applied' })
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
