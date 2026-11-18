// Starts a pre-registration with Paddle: checks the rider's @username is free,
// records a pending row in public.pre_enrollments (start_pre_enrollment) and
// creates a Paddle transaction for the one-time $9.99 payment. The page opens
// that transaction in Paddle's overlay checkout. Nothing is held while the
// rider pays: the username is reserved only when Paddle confirms the payment
// (paddle-webhook).
//
// Secrets: PADDLE_API_KEY, optional PADDLE_PRICE_ID, PADDLE_ENV and
// ALLOWED_ORIGINS. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided by
// Supabase.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { paddleApi } from "../_shared/paddle.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

const PRICE_ID = Deno.env.get("PADDLE_PRICE_ID") ?? "";
// Used only when PADDLE_PRICE_ID isn't set: $9.99 pre-registration
// (Pro is $49.99/year after launch).
const FALLBACK_AMOUNT_CENTS = 999;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Same rule as the app (and the profiles table): 3-24 lowercase letters, numbers, underscores.
const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

const SOURCE_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "ref", "referrer"];

function cleanSource(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object") {
    for (const k of SOURCE_KEYS) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, k === "referrer" ? 300 : 100);
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  if (!Deno.env.get("PADDLE_API_KEY")) {
    console.error("paddle-checkout: PADDLE_API_KEY is not set");
    return json(req, { error: "Checkout isn't set up yet. Please try again later." }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid request." }, 400);
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return json(req, { error: "Enter a valid email address." }, 400);
  }
  const bike = typeof body.bike === "string" && body.bike.trim() ? body.bike.trim().slice(0, 80) : null;
  const username = typeof body.username === "string" && body.username.trim()
    ? body.username.trim().replace(/^@/, "").toLowerCase()
    : null;
  if (username !== null && !USERNAME_RE.test(username)) {
    return json(req, { error: "Usernames are 3-24 lowercase letters, numbers or underscores." }, 400);
  }
  const source = cleanSource(body.source);

  // Check the username and record the pending pre-enrollment (or find the
  // email's existing paid one).
  const { data: rows, error: startErr } = await db.rpc("start_pre_enrollment", {
    p_email: email,
    p_username: username,
    p_source: source,
    p_bike: bike,
  });
  if (startErr) {
    if (startErr.message?.includes("username_taken")) {
      return json(req, { error: "That username is taken. Try another.", username_taken: true }, 409);
    }
    if (startErr.message?.includes("invalid_username")) {
      return json(req, { error: "Usernames are 3-24 lowercase letters, numbers or underscores." }, 400);
    }
    console.error("paddle-checkout: start_pre_enrollment failed", startErr);
    return json(req, { error: "Something went wrong. Please try again." }, 500);
  }
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) {
    console.error("paddle-checkout: start_pre_enrollment returned nothing");
    return json(req, { error: "Something went wrong. Please try again." }, 500);
  }
  // Already paid with this email: don't charge twice.
  if (row.already_paid) return json(req, { already_enrolled: true, username: row.username });

  try {
    const item = PRICE_ID
      ? { price_id: PRICE_ID, quantity: 1 }
      : {
        quantity: 1,
        price: {
          description: "Throttle Pro pre-registration, one-time payment",
          name: "Pre-registration",
          unit_price: { amount: String(FALLBACK_AMOUNT_CENTS), currency_code: "USD" },
          product: {
            name: "Throttle Pro: Pre-registration",
            description: "Pre-register for Throttle Pro. One-time payment.",
            tax_category: "standard",
          },
        },
      };

    const txn = await paddleApi("/transactions", {
      method: "POST",
      body: {
        items: [item],
        collection_mode: "automatic",
        custom_data: { enrollment_id: row.id, plan: "pre_register", username: username ?? "" },
      },
    });

    // Paddle ids live in the stripe_* columns (no schema change needed):
    // stripe_checkout_session_id holds the transaction id (txn_…).
    await db
      .from("pre_enrollments")
      .update({ stripe_checkout_session_id: txn.id, currency: "usd" })
      .eq("id", row.id);

    return json(req, { transaction_id: txn.id });
  } catch (err) {
    console.error("paddle-checkout: Paddle error", err);
    await db.from("pre_enrollments").update({ status: "failed" }).eq("id", row.id);
    return json(req, { error: "Couldn't open checkout. Please try again." }, 502);
  }
});
