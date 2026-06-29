// Matching algorithm — `scoreJob(j, p)` and `calcPathway(p)`.
//
// This is a drop-in replacement for the in-HTML versions with the 4 gaps from
// the spec closed:
//   1. Dynamic weight shift for `priority === 'location'` uses spec values
//      [25, 20, 13, 22, 20] (existing code had [25, 20, 15, 28, 12]).
//   2. Logistics modifiers in Timing: -15 (license), -10 (passport).
//   3. Housing preference modifier in Lifestyle: +10 prefer/has, +5 indep/no.
//   4. Misc spec corrections: empty roles → 70, hobby bonus capped at 40,
//      mindset 'structure' applies -5 to Flexibility.

const MONS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function scoreJob(j, p) {
  // ---- 1. TIMING (default 30%) ------------------------------------------
  let timing = 50;
  if (p.startDate) {
    const jStart = j.start
      ? new Date(j.start)
      : new Date(2025, Math.max(0, MONS.indexOf(j.startMonth)), 1);
    const diff = Math.abs((jStart - new Date(p.startDate)) / 86400000);
    const fx = { none: 0, somewhat: 14, very: 30 }[p.flex] ?? 14;
    timing = diff <= fx ? 100 : diff <= 60 ? 65 : 30;
  }
  if (p.minDuration) {
    const minD = { '2-3': 2, '3-4': 3, '4-6': 4, 'open': 6 }[p.minDuration] || 0;
    const jDur = parseFloat(j.duration) || 3;
    if (jDur < minD - 0.5) timing = Math.min(timing, 35);
  }
  // GAP — logistics modifiers
  if (j.requiresLicense && p.license === 'no') timing -= 15;
  if (j.requiresPassport && p.passport === 'no') timing -= 10;
  timing = Math.max(5, Math.min(100, timing));

  // ---- 2. FINANCIAL (default 25%) ---------------------------------------
  let fin = 50;
  const savMap = { '0-2k': 'low', '2-4k': 'low', '4-6k': 'mid', '6k+': 'high', 'not-sure': 'mid' };
  const ws = savMap[p.savings] || '';
  if (ws) {
    if (ws === j.savingsLevel) fin = 100;
    else if (ws === 'low' && j.savingsLevel === 'mid') fin = 65;
    else fin = 35;
  }
  if (p.income === 'guaranteed' && j.cpi >= 8) fin = Math.min(100, fin + 10);
  if (p.income === 'tips' && j.isTipped) fin = Math.min(100, fin + 10);
  if (p.finGoal === 'save' && j.cpi >= 10) fin = Math.min(100, fin + 15);
  else if (p.finGoal === 'save' && j.cpi >= 8) fin = Math.min(100, fin + 8);
  if (p.finGoal === 'break-even') fin = Math.min(100, fin + 5);
  fin = Math.max(0, Math.min(100, fin));

  // ---- 3. ROLE (default 20%) --------------------------------------------
  let roleScore = 40;
  const avoidText = (p.avoidText || '').toLowerCase();
  const avoided = avoidText && (j.jobRoles || []).some(
    r => avoidText.includes(r.replace(/-/g, ' '))
  );
  if (avoided) {
    roleScore = 5;
  } else if (p.roles && p.roles.length > 0) {
    const hit = p.roles.some(r => (j.jobRoles || []).includes(r));
    if (hit) roleScore = 100;
    else roleScore = p.priority === 'location' ? 55 : 25;
  } else {
    roleScore = 70; // GAP — empty roles defaults to 70 per spec, not 40
  }

  // ---- 4. LIFESTYLE (default 15%) ---------------------------------------
  // Jobs can now list multiple environments (j.envs[]); fall back to the
  // legacy single j.env. Match if ANY job env is in the participant's set.
  const jobEnvs = (j.envs && j.envs.length) ? j.envs : (j.env ? [j.env] : []);
  let envScore = 50;
  if (p.envs && p.envs.length > 0) {
    envScore = jobEnvs.some(e => p.envs.includes(e)) ? 100 : 25;
  }
  const hobbyHits = (p.hobbies || []).filter(h => (j.hobbies || []).includes(h)).length;
  const hobbyBonus = Math.min(hobbyHits * 15, 40); // GAP — cap at 40 per spec
  // GAP — housing preference modifier
  const jobHasHousing = !!(j.housing && j.housing.type && j.housing.type !== 'none');
  let housingMod = 0;
  if (p.housingPref === 'prefer' && jobHasHousing) housingMod = 10;
  else if (p.housingPref === 'independent' && !jobHasHousing) housingMod = 5;
  const life = Math.max(0, Math.min(100, envScore + hobbyBonus + housingMod));

  // ---- 5. FLEXIBILITY (default 10%) -------------------------------------
  let flex = 50;
  if (p.altOpen === 'very') flex = 90;
  else if (p.altOpen === 'somewhat') flex = 65;
  else if (p.altOpen === 'prefer-wait') flex = 30;
  if (p.mindset === 'adapt') flex += 10;
  else if (p.mindset === 'structure') flex -= 5; // GAP
  flex = Math.max(0, Math.min(100, flex));

  // ---- WEIGHTS ----------------------------------------------------------
  // GAP — `location` weights match the spec exactly
  let w = [30, 25, 20, 15, 10];
  if (p.priority === 'role') w = [25, 20, 30, 15, 10];
  else if (p.priority === 'location') w = [25, 20, 13, 22, 20];

  const cats = [timing, fin, roleScore, life, flex];
  const overall = Math.round(cats.reduce((sum, v, i) => sum + (v * w[i]) / 100, 0));
  return { overall, cats };
}

// ============================================================================
// Pathway assignment — evaluate in order, first match wins.
// (Also computed server-side by the recompute_profile_meta trigger; this is
// for the live preview while the participant is editing.)
// ============================================================================

export function calcPathway(p) {
  if (!p || !p.finGoal) return '';
  if (p.finGoal === 'save' && (p.savings === '4-6k' || p.savings === '6k+')) return 'High Earner';
  if (p.finGoal === 'earn-lifestyle' && p.altOpen === 'very') return 'Adventure Seeker';
  if (p.mindset === 'structure') return 'Structured Achiever';
  if ((p.envs || []).includes('mountain')) return 'Mountain Pursuer';
  if ((p.envs || []).includes('coastal')) return 'Coastal Explorer';
  return 'Explorer';
}

// ============================================================================
// Display helpers
// ============================================================================

export function matchLabel(score) {
  if (score >= 75) return 'Strong match';
  if (score >= 55) return 'Good match';
  if (score >= 35) return 'Partial match';
  return 'Low match';
}

export function matchColor(score) {
  if (score >= 75) return '#2A9D6E';
  if (score >= 55) return '#2A94BC';
  return '#EA5A4F';
}

// Tier label only — NEVER expose the raw CPI number to participants.
export function cpiLabel(cpi) {
  if (cpi >= 10) return 'High Cost-Positive';
  if (cpi >= 8) return 'Moderate Cost-Positive';
  if (cpi >= 6) return 'Experience-Focused / Lower Savings';
  return 'Lifestyle-First (Not Savings-Driven)';
}

// Highest match score across open jobs — for the admin sortable participant list.
export function topMatchScore(participant, openJobs) {
  if (!participant?.pd) return 0;
  let best = 0;
  for (const j of openJobs) {
    const s = scoreJob(j, participant.pd).overall;
    if (s > best) best = s;
  }
  return best;
}
