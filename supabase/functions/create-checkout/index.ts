// Starts a pre-registration: checks the rider's @username is free, records a
// pending row in public.pre_enrollments (start_pre_enrollment) and returns a
// Stripe Checkout URL for the one-time $1.99 payment. Nothing is held while
// the rider pays: the username is reserved only when Stripe confirms the
// payment (stripe-webhook). Called by the landing page's form.
//
// Secrets: STRIPE_SECRET_KEY, SITE_URL, optional STRIPE_PRICE_ID and
// ALLOWED_ORIGINS. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided by
// Supabase.
import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  httpClient: Stripe.createFetchHttpClient(),
});

const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

const SITE_URL = (Deno.env.get("SITE_URL") ?? "").replace(/\/+$/, "");
const PRICE_ID = Deno.env.get("STRIPE_PRICE_ID") ?? "";
// Used only when STRIPE_PRICE_ID isn't set: $1.99 pre-registration
// (Pro is $15.99/year after launch).
const FALLBACK_AMOUNT_CENTS = 199;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Same rule as the app (and the profiles table): 3-24 lowercase letters, numbers, underscores.
const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
// Page to come back to after Stripe: a path on this site, e.g. "/" or "/indexv2.html".
const RETURN_RE = /^\/[A-Za-z0-9._\-\/]{0,80}$/;

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
  if (!SITE_URL || !Deno.env.get("STRIPE_SECRET_KEY")) {
    console.error("create-checkout: SITE_URL or STRIPE_SECRET_KEY is not set");
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
  // The old form (index.html) has no username; the new one requires it.
  const username = typeof body.username === "string" && body.username.trim()
    ? body.username.trim().replace(/^@/, "").toLowerCase()
    : null;
  if (username !== null && !USERNAME_RE.test(username)) {
    return json(req, { error: "Usernames are 3-24 lowercase letters, numbers or underscores." }, 400);
  }
  const source = cleanSource(body.source);
  const returnTo = typeof body.return_to === "string" && RETURN_RE.test(body.return_to) ? body.return_to : "/";

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
    console.error("create-checkout: start_pre_enrollment failed", startErr);
    return json(req, { error: "Something went wrong. Please try again." }, 500);
  }
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) {
    console.error("create-checkout: start_pre_enrollment returned nothing");
    return json(req, { error: "Something went wrong. Please try again." }, 500);
  }
  // Already paid with this email: don't charge twice.
  if (row.already_paid) return json(req, { already_enrolled: true, username: row.username });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      customer_creation: "always",
      client_reference_id: row.id,
      metadata: { enrollment_id: row.id, plan: "pre_register", username: username ?? "" },
      payment_intent_data: { metadata: { enrollment_id: row.id, plan: "pre_register" } },
      line_items: [
        PRICE_ID
          ? { price: PRICE_ID, quantity: 1 }
          : {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: FALLBACK_AMOUNT_CENTS,
              product_data: {
                name: "Throttle Pro: Pre-registration",
                description: "Pre-register for Throttle Pro. One-time payment.",
              },
            },
          },
      ],
      success_url: `${SITE_URL}${returnTo}?enrolled={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}${returnTo}?cancelled=1#enroll`,
    });

    await db
      .from("pre_enrollments")
      .update({
        stripe_checkout_session_id: session.id,
        amount_cents: session.amount_total,
        currency: session.currency,
      })
      .eq("id", row.id);

    return json(req, { url: session.url });
  } catch (err) {
    console.error("create-checkout: Stripe error", err);
    await db.from("pre_enrollments").update({ status: "failed" }).eq("id", row.id);
    return json(req, { error: "Couldn't reach the payment page. Please try again." }, 502);
  }
});
