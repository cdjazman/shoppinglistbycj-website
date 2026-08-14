/**
 * functions/api/feedback.js
 * ---------------------------------------------------------------------
 * Public feedback/rating endpoint for shoppinglistbycj.app.
 *
 *   GET  /api/feedback   -> { reviews: [...approved, newest first], count, average }
 *   POST /api/feedback   -> submit a new review; lands in the moderation
 *                           queue (feedback:pending), NOT shown publicly
 *                           until an admin approves it via /api/admin-feedback.
 *
 * Storage: a single Cloudflare KV namespace, bound as FEEDBACK_KV in the
 * Pages project's Functions settings (Settings -> Functions -> KV namespace
 * bindings). Two keys are used, each holding a JSON array:
 *   feedback:pending   - awaiting moderation
 *   feedback:approved  - live on the site
 *
 * Volumes here are tiny (a personal app's review queue), so "read the
 * whole array, mutate, write it back" is simpler and safer than trying
 * to model this as many small KV keys - no pagination/listing edge cases
 * to worry about.
 * ------------------------------------------------------------------- */

const MAX_NAME_LENGTH = 60;
const MIN_TEXT_LENGTH = 3;
const MAX_TEXT_LENGTH = 800;
const RATE_LIMIT_SECONDS = 60 * 60; // one submission per IP per hour
const MAX_APPROVED_RETURNED = 200;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function readList(kv, key) {
  const raw = await kv.get(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function escapeForStorage(value, maxLength) {
  return String(value).trim().slice(0, maxLength);
}

function makeId() {
  // Not cryptographic - just needs to be unique enough to reference one
  // review in the moderation queue.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.FEEDBACK_KV) {
    return jsonResponse({ error: "Feedback storage is not configured." }, 500);
  }

  const approved = await readList(env.FEEDBACK_KV, "feedback:approved");
  const trimmed = approved.slice(0, MAX_APPROVED_RETURNED);
  const average =
    approved.length > 0
      ? approved.reduce((sum, r) => sum + r.rating, 0) / approved.length
      : null;

  return jsonResponse({
    reviews: trimmed,
    count: approved.length,
    average: average !== null ? Math.round(average * 10) / 10 : null,
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.FEEDBACK_KV) {
    return jsonResponse({ error: "Feedback storage is not configured." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonResponse({ error: "Invalid submission." }, 400);
  }

  // Honeypot: a hidden field real visitors never fill in. If it's
  // present, pretend success so bots don't learn to avoid it, but drop
  // the submission on the floor.
  if (body.website) {
    return jsonResponse({ ok: true, message: "Thanks for your feedback!" });
  }

  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return jsonResponse({ error: "Please choose a rating from 1 to 5 stars." }, 400);
  }

  const text = escapeForStorage(body.text || "", MAX_TEXT_LENGTH);
  if (text.length < MIN_TEXT_LENGTH) {
    return jsonResponse({ error: "Please add a little more detail to your feedback." }, 400);
  }

  const name = body.name ? escapeForStorage(body.name, MAX_NAME_LENGTH) : "";

  // Basic IP-based rate limit so the pending queue can't be flooded.
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimitKey = `ratelimit:${ip}`;
  const alreadySubmitted = await env.FEEDBACK_KV.get(rateLimitKey);
  if (alreadySubmitted) {
    return jsonResponse(
      { error: "You've already submitted feedback recently. Thanks — we've got it!" },
      429
    );
  }

  const pending = await readList(env.FEEDBACK_KV, "feedback:pending");
  pending.unshift({
    id: makeId(),
    name: name || null,
    rating,
    text,
    createdAt: new Date().toISOString(),
  });

  await env.FEEDBACK_KV.put("feedback:pending", JSON.stringify(pending));
  await env.FEEDBACK_KV.put(rateLimitKey, "1", { expirationTtl: RATE_LIMIT_SECONDS });

  return jsonResponse({
    ok: true,
    message: "Thanks for your feedback! It'll appear on the site once it's been reviewed.",
  });
}
