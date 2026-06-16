// send-notification — Supabase Edge Function that turns a notifications-row
// INSERT into a Resend email.
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
//   RESEND_API_KEY       — from https://resend.com/api-keys
//   FROM_EMAIL           — e.g. "AdventureEXP <onboarding@resend.dev>"
//                          (use onboarding@resend.dev for dev without a verified domain)
//   SITE_URL             — public URL of the portal, used in CTA links
//
// Auto-provided by Supabase at runtime:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "AdventureEXP <onboarding@resend.dev>";
const SITE_URL = Deno.env.get("SITE_URL") || "http://localhost:8000/adventureexp_portal.html";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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
    .select("email, first_name, notification_settings(email_enabled)")
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
  const { subject, html } = renderTemplate(row.event_type, payload, profile.first_name || "");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: profile.email,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error("[send-notification] resend failed", res.status, txt);
  }
}

// ----------------------------------------------------------------------------
// Templates
// ----------------------------------------------------------------------------

function shell(title: string, firstName: string, bodyHtml: string, ctaText = "Open AdventureEXP") {
  const hi = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,";
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#F7F4EF;padding:32px 16px;color:#1E1C18">
      <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #EDE8DC;border-radius:14px;padding:28px;box-shadow:0 4px 14px rgba(0,0,0,.04)">
        <div style="font-weight:900;font-size:20px;letter-spacing:-.01em;margin-bottom:18px">
          <span style="color:#1E1C18">Adventure</span><span style="color:#D4831A">EXP</span>
        </div>
        <h2 style="font-size:17px;font-weight:800;margin:0 0 14px">${escapeHtml(title)}</h2>
        <p style="line-height:1.6;color:#1E1C18;margin:0 0 12px">${hi}</p>
        <div style="line-height:1.6;color:#1E1C18">${bodyHtml}</div>
        <p style="margin:20px 0 4px">
          <a href="${escapeAttr(SITE_URL)}" style="display:inline-block;background:#FFAD49;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:800;font-size:14px">${escapeHtml(ctaText)} &rarr;</a>
        </p>
        <hr style="border:none;border-top:1px solid #EDE8DC;margin:24px 0">
        <p style="font-size:11px;color:#7A7464;margin:0">You're receiving this from AdventureEXP. Manage your notification preferences in your account settings.</p>
      </div>
    </div>`;
}

function renderTemplate(eventType: string, p: Record<string, any>, firstName: string) {
  switch (eventType) {
    case "application_received":
      return {
        subject: `New application from ${p.participant_name || "a participant"}`,
        html: shell(
          `New application — ${p.job_title || "a position"}`,
          firstName,
          `<p><strong>${escapeHtml(p.participant_name || "A participant")}</strong> applied for <strong>${escapeHtml(p.job_title || "a position")}</strong>${p.employer_name ? ` at <strong>${escapeHtml(p.employer_name)}</strong>` : ""}.</p>`,
          "Review application"
        ),
      };
    case "application_interviewing":
      return {
        subject: `Interview started — ${p.job_title || ""}`,
        html: shell(
          `Interview started`,
          firstName,
          `<p>Your application for <strong>${escapeHtml(p.job_title || "a position")}</strong>${p.employer_name ? ` at <strong>${escapeHtml(p.employer_name)}</strong>` : ""} has moved to <strong>Interviewing</strong>. The team will reach out with next steps.</p>`,
          "Open application"
        ),
      };
    case "application_offered":
      return {
        subject: `🎉 Offer received — ${p.job_title || ""}`,
        html: shell(
          `You've received an offer`,
          firstName,
          `<p>Congratulations — you've received an offer for <strong>${escapeHtml(p.job_title || "a position")}</strong>${p.employer_name ? ` at <strong>${escapeHtml(p.employer_name)}</strong>` : ""}. Open the portal to accept or decline.</p>`,
          "Review offer"
        ),
      };
    case "application_placed":
      return {
        subject: `✨ You're placed at ${p.employer_name || "AdventureEXP"}`,
        html: shell(
          `You're placed!`,
          firstName,
          `<p>You've officially been placed at <strong>${escapeHtml(p.employer_name || "your new role")}</strong> as <strong>${escapeHtml(p.job_title || "")}</strong>.</p><p>Welcome to the team — we'll follow up with next steps soon.</p>`,
          "Open portal"
        ),
      };
    case "application_withdrawn":
      return {
        subject: `Application withdrawn — ${p.job_title || ""}`,
        html: shell(
          `Application withdrawn`,
          firstName,
          `<p>The application for <strong>${escapeHtml(p.job_title || "a position")}</strong>${p.employer_name ? ` at <strong>${escapeHtml(p.employer_name)}</strong>` : ""} has been withdrawn.</p>`,
          "Open portal"
        ),
      };
    case "new_message": {
      const sender = p.sender_name || "Your coordinator";
      return {
        subject: `New message from ${sender}`,
        html: shell(
          `New message`,
          firstName,
          `<p><strong>${escapeHtml(sender)}</strong> sent you a message:</p>
           <blockquote style="margin:14px 0;padding:12px 16px;border-left:3px solid #FFAD49;background:#FFF3E0;color:#1E1C18;border-radius:0 8px 8px 0">${escapeHtml(p.preview || "")}</blockquote>`,
          "Reply"
        ),
      };
    }
    case "employer_verification_request":
      return {
        subject: `Employer verification needed — ${p.employer_name || ""}`,
        html: shell(
          `Verify employer`,
          firstName,
          `<p>An employer <strong>${escapeHtml(p.employer_name || "")}</strong> needs verification. Open the admin panel to review their profile.</p>`,
          "Open admin panel"
        ),
      };
    case "incomplete_profile_reminder":
      return {
        subject: `${p.participant_name || "A participant"} needs profile help`,
        html: shell(
          `Participant profile incomplete`,
          firstName,
          `<p><strong>${escapeHtml(p.participant_name || "A participant")}</strong> hasn't completed their match profile yet${typeof p.profile_score === "number" ? ` (only ${p.profile_score}% filled)` : ""}. Consider reaching out.</p>`,
          "Open admin panel"
        ),
      };
    default:
      return {
        subject: `Notification from AdventureEXP`,
        html: shell(
          `You have a new update`,
          firstName,
          `<p>You have a new update in your AdventureEXP account.</p>`,
          "Open portal"
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
