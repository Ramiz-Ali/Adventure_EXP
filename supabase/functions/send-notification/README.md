# send-notification — deployment runbook

This Edge Function turns every row inserted into `notifications` into a Resend email. Setup is a one-time, ~10-minute job.

## Step 1 — Sign up at Resend

1. Open https://resend.com and sign up.
2. Project Settings → **API Keys** → Create a key. Copy the `re_...` string.
3. (Skip domain verification for now — Resend lets you send via `onboarding@resend.dev` while testing.)

## Step 2 — Set the secrets in Supabase

**Dashboard route (no CLI):**

1. Supabase Dashboard → **Project Settings → Edge Functions → Secrets**.
2. Add these three keys (the bottom two `SUPABASE_*` are auto-provided):

| Key | Value |
|---|---|
| `RESEND_API_KEY` | `re_...` from step 1 |
| `FROM_EMAIL` | `AdventureEXP <onboarding@resend.dev>` (dev) — or your verified domain |
| `SITE_URL` | `https://your-vercel-app.vercel.app/adventureexp_portal.html` (for now, your localhost link works too) |

3. Save.

**CLI route (alternative):**

```bash
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set FROM_EMAIL='AdventureEXP <onboarding@resend.dev>'
supabase secrets set SITE_URL='http://localhost:8000/adventureexp_portal.html'
```

## Step 3 — Deploy the function

**Dashboard route:**

1. Dashboard → **Edge Functions** → **Create a new function** → name it `send-notification`.
2. Paste the entire contents of `index.ts` into the editor.
3. Click **Deploy function**.

**CLI route:**

```bash
supabase functions deploy send-notification --no-verify-jwt
```

The `--no-verify-jwt` flag lets the database webhook (which doesn't have a user JWT) call the function. Authorization happens via the service role key the function reads from secrets.

## Step 4 — Set up the database webhook

1. Dashboard → **Database → Webhooks** → **Create a new hook**.
2. Settings:
   - **Name:** `notifications-to-email`
   - **Table:** `notifications`
   - **Events:** check `Insert` only
   - **Type:** `HTTP Request`
   - **Method:** `POST`
   - **URL:** `https://<your-project-ref>.supabase.co/functions/v1/send-notification`
   - **HTTP Headers:** add one:
     - Name: `Authorization`
     - Value: `Bearer <your-service-role-key>` (Settings → API Keys → service_role)
3. Save.

## Step 5 — Smoke test

Open the SQL Editor and insert a test notification for yourself:

```sql
insert into notifications (recipient_id, event_type, payload)
values (
  (select id from profiles where role = 'admin' limit 1),
  'application_received',
  jsonb_build_object(
    'participant_name', 'Jordan Test',
    'job_title', 'Trail Guide',
    'employer_name', 'Glacier Peak Lodge'
  )
);
```

Within ~5 seconds you should:
- See a new in-app notification (the bell badge increments) — already worked before this function.
- Receive the email at the admin's address (check spam if it's a Gmail).
- See an entry in **Edge Functions → send-notification → Logs** with `mode: "webhook"`.

If you don't get the email:
- **Logs** in Supabase Functions → Logs tab — look for the Resend error response.
- **Resend dashboard** → Logs — shows what was actually sent (or rejected).
- Most common cause: `FROM_EMAIL` uses a domain you haven't verified at Resend. Switch to `onboarding@resend.dev` for testing.

## Local development

```bash
supabase functions serve send-notification --env-file .env.local
```

Then POST to `http://localhost:54321/functions/v1/send-notification` with a webhook-shaped body.

## Production switch

When ready to use a custom domain:

1. Resend → **Domains** → Add your domain → add the DNS records they show you.
2. Wait for verification (~5 minutes after DNS propagation).
3. Update `FROM_EMAIL` secret to `AdventureEXP <noreply@yourdomain.com>`.
4. Redeploy is not needed — env vars are read on each invocation.

## Cost

Resend free tier: 100 emails/day, 3000/month. Plenty for v1.
Supabase Edge Functions free tier: 500K invocations/month. We'll use ~hundreds.

Total monthly cost at MVP scale: **$0**.
