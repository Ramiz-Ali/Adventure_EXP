// Supabase JS client. Single shared instance — import { sb } everywhere.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ENV } from './env.js';

if (!ENV.SUPABASE_URL || ENV.SUPABASE_ANON_KEY === 'PASTE_YOUR_ANON_KEY_HERE') {
  console.error(
    '[supabase] env.js is not filled in. Set SUPABASE_URL and SUPABASE_ANON_KEY in lib/env.js.'
  );
}

// ---------------------------------------------------------------------------
// Hang-proof Supabase client. The real-world failure mode the logs caught:
// `_initialize → _recoverAndRefresh → fetch(/auth/v1/token?grant_type=
// refresh_token)` hangs against the stale token in localStorage. Every later
// auth call (signInWithPassword, getSession, signOut) queues behind it and
// never runs. A lock timeout doesn't help — the underlying fetch keeps
// running in the background and re-poisons the queue.
//
// Two layered guards that solve the problem at the right level:
//
// 1. `noOpLock`: skip navigator.locks entirely (upstream #1594/#2013/#2111).
//    Cross-tab refresh coordination doesn't matter for a single-user portal.
//
// 2. `fetchWithTimeout`: pass a `global.fetch` that wraps every request in
//    an AbortController with a 6s deadline. When a refresh hangs, the abort
//    actually kills the request — supabase-js sees a thrown AbortError,
//    runs its own catch / finally, clears `lockAcquired`, and the next
//    call (your signInWithPassword) runs immediately on a clean lock.
// ---------------------------------------------------------------------------
const PER_REQUEST_TIMEOUT_MS = 6000;

const noOpLock = async (_name, _acquireTimeout, fn) => fn();

function fetchWithTimeout(input, init = {}) {
  const ctrl = new AbortController();
  const timerId = setTimeout(() => ctrl.abort(), PER_REQUEST_TIMEOUT_MS);
  // Compose with any caller-provided abort signal.
  if (init.signal) {
    if (init.signal.aborted) ctrl.abort();
    else init.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timerId));
}

export const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    lock: noOpLock,
  },
  global: {
    fetch: fetchWithTimeout,
  },
});

console.log('[supabase] client ready (noOpLock + ' + PER_REQUEST_TIMEOUT_MS + 'ms fetch timeout)');

// ---------------------------------------------------------------------------
// Boot diagnostics — surfaces the real reason auth calls hang in normal
// Chrome but work in Incognito. Three common causes, all checked here:
//   1. A stale service worker from a prior site on localhost:8000 is
//      intercepting fetch (incognito skips service workers, hence "works").
//   2. A Chrome extension is rewriting/blocking the network call.
//   3. The Supabase project URL itself is unreachable.
// ---------------------------------------------------------------------------
(async () => {
  // (1) Stale service workers can intercept fetch silently. Kill them all.
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      if (regs.length) {
        console.warn('[supabase] found', regs.length, 'service worker(s) on this origin — unregistering (they can intercept fetch and cause auth hangs)');
        await Promise.all(regs.map(r => r.unregister()));
      }
    }
  } catch (e) { console.warn('[supabase] service worker check failed', e); }

  // (2 + 3) Probe the auth endpoint with a 5s timeout. If this fails, no
  // amount of signInWithPassword retries will succeed — the problem is the
  // network path between this browser and Supabase, not the app code.
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(ENV.SUPABASE_URL + '/auth/v1/settings', {
      headers: { apikey: ENV.SUPABASE_ANON_KEY },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    console.log('[supabase] connectivity probe:', res.status, res.ok ? 'OK' : 'FAILED');
  } catch (e) {
    console.error(
      '[supabase] CONNECTIVITY PROBE FAILED — this is why login hangs. ' +
      'Likely cause: a Chrome extension (ad blocker / privacy / VPN) is ' +
      'blocking calls to ' + ENV.SUPABASE_URL + '. ' +
      'Try this tab with all extensions disabled, or in a different browser. ' +
      'Original error:', e
    );
  }
})();
