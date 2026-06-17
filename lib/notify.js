// Notifications: in-system reads + edge-function invocations for the 8 events.
//
// All emailed events go through the `send-notification` edge function. The
// function checks each recipient's notification_settings and decides whether
// to insert the in-system row and/or send the email.

import { sb } from './supabase.js';

// Fire-and-forget: edge function handles in-system insert AND email per
// recipient's notification_settings. Errors are logged but never thrown.
export async function notify(eventType, payload, recipientIds) {
  try {
    const { error } = await sb.functions.invoke('send-notification', {
      body: {
        event_type: eventType,
        payload,
        recipient_ids: recipientIds, // optional — function resolves recipients itself if omitted
      },
    });
    if (error) console.error('[notify]', eventType, error);
  } catch (e) {
    console.error('[notify] failed', eventType, e);
  }
}

// Admin-initiated events that don't have a DB trigger source
// (employer_verification_request, incomplete_profile_reminder). Inserts one
// notifications row per recipient — RLS lets admins do this, and the existing
// Database Webhook on `notifications` INSERT picks them up and emails the
// recipient via the send-notification edge function.
export async function notifyAdmin(eventType, payload, recipientIds) {
  if (!Array.isArray(recipientIds) || recipientIds.length === 0) return;
  const rows = recipientIds.map(id => ({
    recipient_id: id,
    event_type: eventType,
    payload,
  }));
  const { error } = await sb.from('notifications').insert(rows);
  if (error) console.error('[notifyAdmin]', eventType, error);
}

// ----- In-system inbox helpers -----

export async function listMyNotifications(userId, { unreadOnly = false } = {}) {
  let q = sb.from('notifications').select('*').eq('recipient_id', userId);
  if (unreadOnly) q = q.is('read_at', null);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function unreadCount(userId) {
  const { count, error } = await sb
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', userId)
    .is('read_at', null);
  if (error) throw error;
  return count || 0;
}

export async function markRead(notificationId) {
  await sb.from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId);
}

export async function markAllRead(userId) {
  await sb.from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', userId)
    .is('read_at', null);
}

// ----- Settings (toggle in-system / email per user) -----

export async function getNotificationSettings(userId) {
  const { data, error } = await sb
    .from('notification_settings')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function setNotificationSetting(userId, field, value) {
  if (field !== 'in_system_enabled' && field !== 'email_enabled') {
    throw new Error('invalid notification setting field');
  }
  const { error } = await sb
    .from('notification_settings')
    .update({ [field]: value })
    .eq('user_id', userId);
  if (error) throw error;
}

// ----- Realtime subscription for live bell updates -----

export function subscribeToMyNotifications(userId, onInsert) {
  const ch = sb
    .channel(`notifications-${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_id=eq.${userId}`,
      },
      payload => onInsert(payload.new)
    )
    .subscribe();
  return () => sb.removeChannel(ch);
}
