/**
 * functions/api/admin-feedback.js
 * ---------------------------------------------------------------------
 * Private moderation endpoint - lists pending feedback and lets you
 * approve/reject it. Protected by a shared-secret token (not a full
 * login system - proportionate to a solo/hobby project's one admin).
 *
 * Set the secret in Cloudflare Pages: Settings -> Environment variables
 * -> add ADMIN_TOKEN (mark it as "Secret", not plain text) for the
 * Production environment. Use a long random string, e.g. generate one
 * with `openssl rand -hex 32`.
 *
 *   GET  /api/admin-feedback?token=...              -> { pending: [...] }
 *   POST /api/admin-feedback  { token, id, action }  -> approve or reject
 *                                                        one pending item
 * ------------------------------------------------------------------- */

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

// Constant-time-ish string compare so token checks don't leak timing
// information via early-exit comparison. Overkill for a hobby project's
// threat model, but costs nothing to include.
function tokensMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function isAuthorized(env, token) {
  return Boolean(env.ADMIN_TOKEN) && tokensMatch(token || "", env.ADMIN_TOKEN);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.FEEDBACK_KV) {
    return jsonResponse({ error: "Feedback storage is not configured." }, 500);
  }

  const token = new URL(request.url).searchParams.get("token");
  if (!isAuthorized(env, token)) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  const pending = await readList(env.FEEDBACK_KV, "feedback:pending");
  return jsonResponse({ pending });
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
    return jsonResponse({ error: "Invalid request." }, 400);
  }

  if (!isAuthorized(env, body.token)) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  const { id, action } = body;
  if (!id || (action !== "approve" && action !== "reject")) {
    return jsonResponse({ error: "Missing or invalid id/action." }, 400);
  }

  const pending = await readList(env.FEEDBACK_KV, "feedback:pending");
  const index = pending.findIndex((item) => item.id === id);
  if (index === -1) {
    return jsonResponse({ error: "That item is no longer in the queue." }, 404);
  }

  const [item] = pending.splice(index, 1);
  await env.FEEDBACK_KV.put("feedback:pending", JSON.stringify(pending));

  if (action === "approve") {
    const approved = await readList(env.FEEDBACK_KV, "feedback:approved");
    approved.unshift({
      id: item.id,
      name: item.name,
      rating: item.rating,
      text: item.text,
      createdAt: item.createdAt,
      approvedAt: new Date().toISOString(),
    });
    await env.FEEDBACK_KV.put("feedback:approved", JSON.stringify(approved));
  }

  return jsonResponse({ ok: true, action, id });
}
