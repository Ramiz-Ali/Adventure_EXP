// Photo upload helpers: resize on upload + retry on patchy connections.

import { sb } from './supabase.js';

const MAX_DIMENSION = 1200;
const QUALITY = 0.85;

async function resize(file) {
  // OffscreenCanvas + createImageBitmap work on iOS Safari 16+ and all desktop browsers.
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/webp', quality: QUALITY });
}

async function uploadWithRetry(bucket, path, blob, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const { error } = await sb.storage
      .from(bucket)
      .upload(path, blob, { upsert: true, contentType: blob.type });
    if (!error) return path;
    lastErr = error;
    await new Promise(r => setTimeout(r, 500 * (i + 1))); // 0.5s, 1.0s, 1.5s
  }
  throw lastErr;
}

function publicUrl(bucket, path) {
  return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// ----- Profile photos -----
// Path: <user-id>/avatar.webp. RLS lets users write only to their own folder.

export async function uploadProfilePhoto(file, userId) {
  const blob = await resize(file);
  const path = `${userId}/avatar.webp`;
  await uploadWithRetry('profile-photos', path, blob);
  return publicUrl('profile-photos', path) + `?v=${Date.now()}`; // cache-bust replaces
}

// ----- Employer photos -----
// Path: <employer-id>/<uuid>.webp. Admin-only writes (RLS).

export async function uploadEmployerPhoto(file, employerId) {
  const blob = await resize(file);
  const path = `${employerId}/${crypto.randomUUID()}.webp`;
  await uploadWithRetry('employer-photos', path, blob);
  return publicUrl('employer-photos', path);
}

export async function removeEmployerPhoto(url) {
  const path = url.split('/employer-photos/')[1]?.split('?')[0];
  if (!path) return;
  await sb.storage.from('employer-photos').remove([path]);
}

// ----- Housing photos (per job) -----
// Path: <job-id>/<uuid>.webp. Admin-only writes (RLS).

export async function uploadHousingPhoto(file, jobId) {
  const blob = await resize(file);
  const path = `${jobId}/${crypto.randomUUID()}.webp`;
  await uploadWithRetry('housing-photos', path, blob);
  return publicUrl('housing-photos', path);
}

export async function removeHousingPhoto(url) {
  const path = url.split('/housing-photos/')[1]?.split('?')[0];
  if (!path) return;
  await sb.storage.from('housing-photos').remove([path]);
}
