// Browser-safe environment values. The anon key is meant to ship to the browser
// (it is paired with RLS). Never put the service_role key here.
//
// For Vercel deploy, you can either:
//   (a) commit this file as-is with your real anon key — it is public, and
//   (b) add a build step that rewrites it from Vercel env vars.

export const ENV = {
  SUPABASE_URL: 'https://cqxrxnfmxxewuippkucw.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxeHJ4bmZteHhld3VpcHBrdWN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNTc3MjQsImV4cCI6MjA5NjgzMzcyNH0.xCD3Lto4_syr4ifMi94Ms3A0l_ncqkp2YxWPH66odxg',
  SITE_URL: typeof window !== 'undefined' ? window.location.origin : '',
};
