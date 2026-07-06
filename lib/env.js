// Browser-safe environment values. The anon key is meant to ship to the browser
// (it is paired with RLS). Never put the service_role key here.
//
// For Vercel deploy, you can either:
//   (a) commit this file as-is with your real anon key — it is public, and
//   (b) add a build step that rewrites it from Vercel env vars.

export const ENV = {
  SUPABASE_URL: 'https://tvsyigtzbrutzishrton.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2c3lpZ3R6YnJ1dHppc2hydG9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMDQzMTYsImV4cCI6MjA5NjY4MDMxNn0.TU-1y05J33pcmulZjVvMLptd8Nd-_MzgQLh__oYb4bA',
  SITE_URL: typeof window !== 'undefined' ? window.location.origin : '',
};
