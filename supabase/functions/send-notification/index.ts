// send-notification — Supabase Edge Function that turns a notifications-row
// INSERT into an email, sent over SMTP (SiteGround).
//
// Triggered two ways:
//   1. Database Webhook on `notifications` INSERT (preferred, automatic).
//      Payload: { type: "INSERT", table: "notifications", record: {...} }
//   2. Direct invoke from the client (legacy `Notify.notify(...)` calls).
//      Payload: { event_type, payload, recipient_ids? }
//      Direct invokes are accepted but mostly redundant — the DB triggers
//      already create the notification row, which fires the webhook above.
//      We respond OK so the client never sees a failure.
//
// Required secrets (set via Supabase Dashboard → Project Settings → Edge Functions):
//   SMTP_HOST            — e.g. "giowm1315.siteground.biz"
//   SMTP_PORT            — "465" (implicit SSL/TLS). 587 would need STARTTLS (see below).
//   SMTP_USER            — full mailbox address, e.g. "noreply@adventureexp.com"
//   SMTP_PASS            — password for that mailbox
//   FROM_EMAIL           — display + address, e.g. "AdventureEXP <noreply@adventureexp.com>"
//                          MUST be on the authenticated domain — SiteGround rejects others.
//   SITE_URL             — public URL of the portal, used in CTA links
//
// Auto-provided by Supabase at runtime:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SMTP_HOST = Deno.env.get("SMTP_HOST")!;
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") || "465");
const SMTP_USER = Deno.env.get("SMTP_USER")!;
const SMTP_PASS = Deno.env.get("SMTP_PASS")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "AdventureEXP <noreply@adventureexp.com>";
const SITE_URL = Deno.env.get("SITE_URL") || "http://localhost:8000/adventureexp_portal.html";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Port 465 = implicit TLS (connection encrypted from the start).
// Port 587/2525 = plaintext connect then STARTTLS upgrade.
function makeSmtpClient() {
  const implicitTls = SMTP_PORT === 465;
  return new SMTPClient({
    connection: {
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      tls: implicitTls,
      auth: { username: SMTP_USER, password: SMTP_PASS },
    },
  });
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificationRow {
  id?: string;
  recipient_id: string;
  event_type: string;
  payload?: Record<string, unknown>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST")    return json({ ok: false, error: "method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); }
  catch { return json({ ok: false, error: "invalid json" }, 400); }

  try {
    if (body?.type === "INSERT" && body?.table === "notifications" && body?.record) {
      await sendFromRow(body.record as NotificationRow);
      return json({ ok: true, mode: "webhook" });
    }
    if (body?.event_type) {
      // Direct client invocation — accept silently; the DB trigger already
      // created the notification row which fired the webhook path above.
      return json({ ok: true, mode: "noop-direct" });
    }
    return json({ ok: true, mode: "noop-unrecognized" });
  } catch (e) {
    console.error("[send-notification] error", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function sendFromRow(row: NotificationRow) {
  const { data: profile, error } = await sb
    .from("profiles")
    .select("email, first_name, role, notification_settings(email_enabled)")
    .eq("id", row.recipient_id)
    .single();

  if (error || !profile?.email) {
    console.warn("[send-notification] recipient not found", row.recipient_id, error);
    return;
  }

  // Respect per-user email opt-out. Default is enabled.
  const settings = (profile as any).notification_settings;
  const enabled = Array.isArray(settings) ? settings[0]?.email_enabled : settings?.email_enabled;
  if (enabled === false) return;

  const payload = (row.payload || {}) as Record<string, any>;
  const ctaUrl = ctaUrlFor(gotoFor(row.event_type, (profile as any).role || "participant"));
  const { subject, html } = renderTemplate(row.event_type, payload, profile.first_name || "", ctaUrl);

  const client = makeSmtpClient();
  try {
    await client.send({
      from: FROM_EMAIL,
      to: profile.email,
      subject,
      html,
      content: "auto", // auto-generate a plain-text part from the HTML
    });
  } catch (e) {
    console.error("[send-notification] smtp send failed", String(e));
    throw e;
  } finally {
    await client.close();
  }
}

// ----------------------------------------------------------------------------
// Templates
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Deep links — each event points the CTA at the relevant tab in the SPA via a
// `?goto=` query param. The portal reads it on load (after auth) and routes
// there. Without this, every button landed on the bare site root.
//   participant tabs: dashboard | discover | listings | applications | profile | messages
//   admin tabs:       overview | students | employers | applications | reviews | settings
// ----------------------------------------------------------------------------
function gotoFor(eventType: string, role: string): string {
  switch (eventType) {
    case "application_received":              return "applications"; // admin → Applications
    case "application_interviewing":
    case "application_offered":
    case "application_placed":
    case "application_withdrawn":             return "applications"; // participant → Applied
    case "new_message":                       return role === "admin" ? "applications" : "messages";
    case "employer_verification_request":     return "employers";    // admin
    case "incomplete_profile_reminder":       return "students";     // admin
    default:                                  return "";
  }
}

function ctaUrlFor(goto: string): string {
  if (!goto) return SITE_URL;
  const sep = SITE_URL.includes("?") ? "&" : "?";
  return `${SITE_URL}${sep}goto=${encodeURIComponent(goto)}`;
}

const BRAND_ORANGE = "#D4831A";
const BRAND_BTN = "#E8902A";
const PAGE_BG = "#F2EDE4";
const TEXT = "#1E1C18";
const MUTED = "#7A7464";
const BORDER = "#EAE3D6";

// Professional, email-client-safe shell. Table-based layout (renders in Outlook,
// Gmail, Apple Mail), inline styles only, dark-header brand bar, single CTA.
function shell(
  title: string,
  firstName: string,
  bodyHtml: string,
  ctaText: string,
  ctaUrl: string,
  preheader = "",
) {
  const hi = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${PAGE_BG};-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAGE_BG};font-size:1px;line-height:1px">${escapeHtml(preheader || title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${BORDER};border-radius:16px;overflow:hidden;box-shadow:0 6px 22px rgba(30,28,24,.06)">
      <!-- Brand header -->
      <tr><td style="background:${TEXT};padding:22px 32px">
        <span style="font-family:'Nunito',Helvetica,Arial,sans-serif;font-weight:800;font-size:21px;letter-spacing:-.01em;color:#ffffff">Adventure</span><span style="font-weight:800;font-size:21px;letter-spacing:-.01em;color:${BRAND_ORANGE}">EXP</span>
      </td></tr>
      <!-- Accent rule -->
      <tr><td style="height:4px;background:${BRAND_ORANGE};line-height:4px;font-size:0">&nbsp;</td></tr>
      <!-- Body -->
      <tr><td style="padding:32px">
        <h1 style="margin:0 0 18px;font-size:20px;line-height:1.3;font-weight:800;color:${TEXT}">${escapeHtml(title)}</h1>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${TEXT}">${hi}</p>
        <div style="font-size:15px;line-height:1.65;color:${TEXT}">${bodyHtml}</div>
        <!-- CTA -->
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px">
          <tr><td align="center" bgcolor="${BRAND_BTN}" style="border-radius:10px">
            <a href="${escapeAttr(ctaUrl)}" target="_blank" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:10px;font-family:'Nunito',Helvetica,Arial,sans-serif">${escapeHtml(ctaText)} &rarr;</a>
          </td></tr>
        </table>
        <p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:${MUTED}">Or paste this link into your browser:<br><a href="${escapeAttr(ctaUrl)}" target="_blank" style="color:${BRAND_ORANGE};word-break:break-all">${escapeHtml(ctaUrl)}</a></p>
      </td></tr>
      <!-- Footer -->
      <tr><td style="padding:20px 32px;background:#FAF7F1;border-top:1px solid ${BORDER}">
        <p style="margin:0 0 4px;font-size:12px;line-height:1.5;color:${MUTED}">You're receiving this because you have an AdventureEXP account. Manage email preferences in your account settings.</p>
        <p style="margin:0;font-size:12px;color:${MUTED}">&copy; AdventureEXP &middot; Seasonal Work Matching</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function renderTemplate(eventType: string, p: Record<string, any>, firstName: string, ctaUrl: string) {
  const at = p.employer_name ? ` at <strong>${escapeHtml(p.employer_name)}</strong>` : "";
  const role = (t: string) => `<strong>${escapeHtml(t || "a position")}</strong>`;
  switch (eventType) {
    case "application_received":
      return {
        subject: `New application from ${p.participant_name || "a participant"}`,
        html: shell(
          `New application — ${p.job_title || "a position"}`,
          firstName,
          `<p style="margin:0"><strong>${escapeHtml(p.participant_name || "A participant")}</strong> applied for ${role(p.job_title)}${at}.</p>`,
          "Review application",
          ctaUrl,
          `${p.participant_name || "A participant"} applied for ${p.job_title || "a position"}`,
        ),
      };
    case "application_interviewing":
      return {
        subject: `Interview started — ${p.job_title || ""}`,
        html: shell(
          `Your interview has started`,
          firstName,
          `<p style="margin:0">Your application for ${role(p.job_title)}${at} has moved to <strong>Interviewing</strong>. The team will reach out with next steps shortly.</p>`,
          "Open application",
          ctaUrl,
          `${p.job_title || "Your application"} moved to Interviewing`,
        ),
      };
    case "application_offered":
      return {
        subject: `🎉 You've received an offer — ${p.job_title || ""}`,
        html: shell(
          `Congratulations — you've received an offer!`,
          firstName,
          `<p style="margin:0">You've received an offer for ${role(p.job_title)}${at}. Open the portal to accept or decline.</p>`,
          "Review offer",
          ctaUrl,
          `Offer for ${p.job_title || "a position"}`,
        ),
      };
    case "application_placed":
      return {
        subject: `✨ You're placed at ${p.employer_name || "AdventureEXP"}`,
        html: shell(
          `You're officially placed!`,
          firstName,
          `<p style="margin:0 0 12px">You've been placed at <strong>${escapeHtml(p.employer_name || "your new role")}</strong> as ${role(p.job_title)}.</p><p style="margin:0">Welcome to the team — we'll follow up with next steps soon.</p>`,
          "Open portal",
          ctaUrl,
          `You're placed at ${p.employer_name || "AdventureEXP"}`,
        ),
      };
    case "application_withdrawn":
      return {
        subject: `Application withdrawn — ${p.job_title || ""}`,
        html: shell(
          `Application withdrawn`,
          firstName,
          `<p style="margin:0">The application for ${role(p.job_title)}${at} has been withdrawn. If this was unexpected, reach out to your coordinator.</p>`,
          "Open portal",
          ctaUrl,
          `Application withdrawn — ${p.job_title || ""}`,
        ),
      };
    case "new_message": {
      const sender = p.sender_name || "Your coordinator";
      return {
        subject: `New message from ${sender}`,
        html: shell(
          `New message`,
          firstName,
          `<p style="margin:0 0 6px"><strong>${escapeHtml(sender)}</strong> sent you a message:</p>
           <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0"><tr>
             <td style="padding:14px 18px;background:#FFF6EA;border-left:4px solid ${BRAND_ORANGE};border-radius:0 10px 10px 0;font-size:15px;line-height:1.6;color:${TEXT}">${escapeHtml(p.preview || "")}</td>
           </tr></table>`,
          "Read & reply",
          ctaUrl,
          `${sender}: ${p.preview || "new message"}`,
        ),
      };
    }
    case "employer_verification_request":
      return {
        subject: `Employer verification needed — ${p.employer_name || ""}`,
        html: shell(
          `Employer verification needed`,
          firstName,
          `<p style="margin:0">Employer <strong>${escapeHtml(p.employer_name || "")}</strong> needs verification. Open the admin panel to review their profile and approve.</p>`,
          "Review employer",
          ctaUrl,
          `Verify ${p.employer_name || "an employer"}`,
        ),
      };
    case "incomplete_profile_reminder":
      return {
        subject: `${p.participant_name || "A participant"} needs profile help`,
        html: shell(
          `Participant profile incomplete`,
          firstName,
          `<p style="margin:0"><strong>${escapeHtml(p.participant_name || "A participant")}</strong> hasn't completed their match profile yet${typeof p.profile_score === "number" ? ` (only ${p.profile_score}% filled)` : ""}. Consider reaching out to help them finish.</p>`,
          "View participant",
          ctaUrl,
          `${p.participant_name || "A participant"} has an incomplete profile`,
        ),
      };
    default:
      return {
        subject: `Notification from AdventureEXP`,
        html: shell(
          `You have a new update`,
          firstName,
          `<p style="margin:0">You have a new update in your AdventureEXP account.</p>`,
          "Open portal",
          ctaUrl,
        ),
      };
  }
}

function escapeHtml(s: any) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(s: any) { return escapeHtml(s); }
