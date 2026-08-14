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
 *
 * Every submission also runs through automated moderation (see below) and
 * the result is stored alongside it as `moderation`. This never blocks a
 * submission - it only flags likely explicit/abusive/degrading content so
 * the admin queue can surface it clearly instead of you having to read
 * every review closely yourself.
 * ------------------------------------------------------------------- */

const MAX_NAME_LENGTH = 60;
const MIN_TEXT_LENGTH = 3;
const MAX_TEXT_LENGTH = 800;
const RATE_LIMIT_SECONDS = 60 * 60; // one submission per IP per hour
const MAX_APPROVED_RETURNED = 200;

/**
 * Moderation
 * ---------------------------------------------------------------------
 * Two free layers, both best-effort - neither one ever blocks a
 * submission from reaching the pending queue. Everything still goes
 * through you at /admin-feedback.html; this just flags the stuff worth
 * looking at twice (or not reading in full at all) so you don't have to
 * eyeball every review closely.
 *
 * Layer 1 - instant local blocklist. Zero latency, zero cost, works even
 * if the AI binding below is unavailable. This starter list only covers
 * the most unambiguous English profanity/slurs - it is NOT meant to be
 * exhaustive. For a fuller list, drop in an open-source one such as
 * github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words
 * (just replace the array below).
 *
 * Layer 2 - Cloudflare Workers AI's Llama Guard 3 (@cf/meta/llama-guard-3-8b),
 * a model fine-tuned specifically for content-safety classification. Free
 * within the account's daily Workers AI Neuron allowance (10,000/day as of
 * writing - plenty for a hobby-project review form), no separate signup or
 * card needed since it's the same Cloudflare account already used for
 * FEEDBACK_KV. Requires binding `AI` to the Pages project (Settings ->
 * Functions -> Workers AI bindings -> variable name `AI`) - if that binding
 * isn't set up, this layer silently no-ops rather than failing the
 * submission.
 *
 * Llama Guard reports categories as short codes (S1, S10, S12, ...) per
 * the standard MLCommons taxonomy it was trained on. The map below is for
 * display only in the admin queue - if Cloudflare ever changes the exact
 * codes, unrecognised ones still show up as their raw code rather than
 * breaking anything.
 * ------------------------------------------------------------------- */

const LOCAL_BLOCKLIST = [
  // Deliberately short and unambiguous - this is a fast-fail fallback,
  // not the primary filter. Expand with an open-source list if wanted.
  "fuck", "shit", "cunt", "nigger", "faggot", "retard", "whore", "bitch",
];

const MODERATION_CATEGORY_LABELS = {
  S1: "Violent crimes",
  S2: "Non-violent crimes",
  S3: "Sex-related crimes",
  S4: "Child sexual exploitation",
  S5: "Defamation",
  S6: "Specialized advice",
  S7: "Privacy",
  S8: "Intellectual property",
  S9: "Weapons",
  S10: "Hate / degrading language",
  S11: "Suicide & self-harm",
  S12: "Sexual content",
  S13: "Elections",
  S14: "Code interpreter abuse",
};

function localBlocklistHit(text) {
  const lower = text.toLowerCase();
  return LOCAL_BLOCKLIST.some((word) => lower.includes(word));
}

async function runAiModeration(env, text) {
  if (!env.AI) return { checked: false, flagged: false, categories: [] };

  try {
    const result = await env.AI.run("@cf/meta/llama-guard-3-8b", {
      messages: [{ role: "user", content: text }],
    });
    const raw = String(result && result.response ? result.response : "").trim();
    const flagged = /unsafe/i.test(raw);
    const categories = Array.from(new Set((raw.match(/S(?:1[0-4]|[1-9])(?!\d)/g) || [])));
    return { checked: true, flagged, categories };
  } catch (err) {
    // Fail open: if Workers AI errors, times out, or the binding is
    // misconfigured, the submission still goes through unflagged rather
    // than being lost or blocked.
    return { checked: false, flagged: false, categories: [] };
  }
}

async function moderateText(env, text) {
  const [blocklistHit, ai] = await Promise.all([
    Promise.resolve(localBlocklistHit(text)),
    runAiModeration(env, text),
  ]);

  const categories = blocklistHit
    ? Array.from(new Set([...ai.categories, "blocklist"]))
    : ai.categories;

  return {
    flagged: blocklistHit || ai.flagged,
    checked: ai.checked || blocklistHit,
    categories,
  };
}

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

  const moderation = await moderateText(env, [name, text].filter(Boolean).join("\n"));

  const pending = await readList(env.FEEDBACK_KV, "feedback:pending");
  pending.unshift({
    id: makeId(),
    name: name || null,
    rating,
    text,
    createdAt: new Date().toISOString(),
    moderation,
  });

  await env.FEEDBACK_KV.put("feedback:pending", JSON.stringify(pending));
  await env.FEEDBACK_KV.put(rateLimitKey, "1", { expirationTtl: RATE_LIMIT_SECONDS });

  return jsonResponse({
    ok: true,
    message: "Thanks for your feedback! It'll appear on the site once it's been reviewed.",
  });
}
