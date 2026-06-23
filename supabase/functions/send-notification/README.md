# send-notification — deployment runbook

This Edge Function turns every row inserted into `notifications` into an email, sent over **SMTP** (the client's SiteGround mailbox). Setup is a one-time, ~10-minute job.

## Step 1 — Confirm the sender mailbox

The client created a dedicated mailbox on their domain (SiteGround rejects sends from addresses outside the authenticated domain). You should have:

- **SMTP host** — e.g. `giowm1315.siteground.biz`
- **Port** — `465` (implicit SSL/TLS). `587`/`2525` also work but use STARTTLS.
- **Username** — the full address, e.g. `noreply@adventureexp.com`
- **Password** — for that mailbox
- **Display name** — e.g. `AdventureEXP`

Sanity-check the password by logging into webmail (Site Tools → Email → Accounts → ⋮ → Log in to Webmail) before debugging anything else.

## Step 2 — Set the secrets in Supabase

**Dashboard route (no CLI):**

1. Supabase Dashboard → **Project Settings → Edge Functions → Secrets**.
2. Add these (the `SUPABASE_*` pair is auto-provided, don't add them):

| Key | Value |
|---|---|
| `SMTP_HOST` | `giowm1315.siteground.biz` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `noreply@adventureexp.com` |
| `SMTP_PASS` | the mailbox password |
| `FROM_EMAIL` | `AdventureEXP <noreply@adventureexp.com>` — **must** be on the authenticated domain |
| `SITE_URL` | `https://your-vercel-app.vercel.app/adventureexp_portal.html` |

3. Save. (Any old `RESEND_API_KEY` can be deleted — it's no longer read.)

**CLI route (alternative):**

```bash
supabase secrets set SMTP_HOST=giowm1315.siteground.biz
supabase secrets set SMTP_PORT=465
supabase secrets set SMTP_USER=noreply@adventureexp.com
supabase secrets set SMTP_PASS='the-mailbox-password'
supabase secrets set FROM_EMAIL='AdventureEXP <noreply@adventureexp.com>'
supabase secrets set SITE_URL='https://your-vercel-app.vercel.app/adventureexp_portal.html'
```

> Never commit `SMTP_PASS` to git — it lives only in Supabase secrets.

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
- See a new in-app notification (the bell badge increments).
- Receive the email at the admin's address (check spam if it's Gmail).
- See an entry in **Edge Functions → send-notification → Logs** with `mode: "webhook"`.

If you don't get the email, check the function **Logs** for `smtp send failed`. Common causes:
- Wrong `SMTP_PASS` or `SMTP_HOST` → auth/connection error in the log.
- `FROM_EMAIL` not on the authenticated domain → SiteGround rejects the send.
- Port mismatch — use `465` for implicit TLS.

## Deliverability (avoid the spam folder)

SiteGround auto-configures SPF/DKIM for domains hosted with them. Confirm **DMARC** exists for `adventureexp.com`:

```bash
dig +short TXT _dmarc.adventureexp.com
```

If nothing returns, ask the client to add a DMARC record (a simple `v=DMARC1; p=none; rua=mailto:...` is enough to start). If DNS is managed off SiteGround, the SPF/DKIM records need to be copied there too.

## Sending limits

SiteGround shared hosting caps outgoing mail (~a few hundred/hour depending on plan). Fine for transactional volume. If volume grows or delivery analytics are needed, the send call in `index.ts` can be swapped to an API provider (SES/Postmark) without touching the templates or the webhook wiring.

## Local development

```bash
supabase functions serve send-notification --env-file .env.local
```

Put the `SMTP_*` / `FROM_EMAIL` / `SITE_URL` vars in `.env.local` (gitignored). Then POST to `http://localhost:54321/functions/v1/send-notification` with a webhook-shaped body.
