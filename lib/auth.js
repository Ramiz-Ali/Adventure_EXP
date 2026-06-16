// Auth flows: signup, login (participant + admin), logout, password reset, session helpers.

import { sb } from './supabase.js';
import { ENV } from './env.js';

// ----- Session / profile -----

export async function getCurrentSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function fetchProfile(userId) {
  console.log('[auth] fetchProfile start', userId);
  const t0 = performance.now();
  // Defence-in-depth: even with the global fetchWithTimeout, race the whole
  // PostgREST chain against a 7s ceiling so a hung embedded join can never
  // leave the login button stuck on "Signing in…".
  const query = sb
    .from('profiles')
    .select('*, program_profile(*), notification_settings(*)')
    .eq('id', userId)
    .maybeSingle();
  const result = await Promise.race([
    query,
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error('[auth] fetchProfile timeout > 7s')), 7000)
    ),
  ]);
  const { data, error } = result;
  console.log('[auth] fetchProfile done in', Math.round(performance.now() - t0), 'ms', { hasData: !!data, error });
  if (error) throw error;
  if (!data) {
    // .maybeSingle() returns null when no row exists. The `handle_new_user`
    // trigger should have created a profiles row at signup — if it didn't,
    // the auth user is orphaned and signing in will go nowhere. Surface a
    // real error instead of hanging.
    throw new Error('No profile row found for user ' + userId + '. The handle_new_user trigger may not have fired — check supabase/migrations/0001_init.sql is applied.');
  }
  return data;
}

export async function getCurrentUser() {
  console.log('[auth] getCurrentUser start');
  const session = await getCurrentSession();
  if (!session) { console.log('[auth] getCurrentUser: no session'); return null; }
  return fetchProfile(session.user.id);
}

// ----- Signup -----

export async function signup({ firstName, lastName, email, password, timezone }) {
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: { first_name: firstName, last_name: lastName, timezone },
    },
  });
  if (error) throw error;
  return data; // data.session is null if email confirmation is required
}

// ----- Login -----

export async function login(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// Admin login = same backend, but verify role after.
// Returns { ok: true } or { ok: false, reason }.
export async function adminLogin(email, password) {
  await login(email, password);
  const me = await getCurrentUser();
  if (!me || me.role !== 'admin') {
    await sb.auth.signOut();
    return { ok: false, reason: 'This account is not an admin.' };
  }
  return { ok: true, user: me };
}

// ----- Logout -----

export async function logout() {
  await sb.auth.signOut();
}

// ----- Password reset -----

export async function requestPasswordReset(email) {
  // Always redirect back to the exact portal page (origin + pathname). Using
  // ENV.SITE_URL was a mistake — that's just origin and strips the path,
  // dumping users at the wrong page after they click the reset link.
  const redirectTo = (typeof window !== 'undefined')
    ? (window.location.origin + window.location.pathname)
    : '';
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export async function setNewPassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
}

// ----- Error messages -----

export function mapAuthError(e) {
  const m = (e?.message || '').toLowerCase();
  if (m.includes('invalid login credentials')) return 'Email or password is incorrect.';
  if (m.includes('email not confirmed')) return 'Confirm your email before signing in.';
  if (m.includes('already registered') || m.includes('user already')) return 'Email already in use.';
  if (m.includes('password should be')) return 'Password is too weak — use 8+ characters with a mix.';
  return e?.message || 'Something went wrong.';
}

// ----- Auth state subscription -----
// Caller passes a callback that receives the resolved profile (or null on signout).

export function onAuthChange(handler) {
  // CRITICAL: supabase-js's `onAuthStateChange` callback runs WHILE the
  // GoTrue auth lock is held. Any async supabase call from inside the
  // callback (including a PostgREST query, because it needs auth.getSession()
  // to attach the JWT header) will queue behind that same lock and
  // deadlock. Empirically this manifests as the first fetchProfile after a
  // page-load SIGNED_IN hanging until the 7s race timer fires, while later
  // fetches run in <500ms.
  //
  // Documented workaround: do not await anything supabase-related inside
  // the listener. Defer all real work to setTimeout(0) so the lock
  // releases first. (See supabase-js docs and discussions #5641 / #4150.)
  return sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      handler(null, event);
      return;
    }
    setTimeout(async () => {
      try {
        const profile = await fetchProfile(session.user.id);
        handler(profile, event);
      } catch (err) {
        console.error('[auth] fetchProfile failed for event', event, err);
        // Only clear localStorage on a RESTORED session failure
        // (INITIAL_SESSION / TOKEN_REFRESHED). On a fresh SIGNED_IN we let
        // doLogin surface the error — signing out here would create a
        // sign-in → sign-out → re-render loop that hides the real problem.
        if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
          try { await sb.auth.signOut({ scope: 'local' }); } catch (_) {}
        }
        handler(null, event);
      }
    }, 0);
  });
}
