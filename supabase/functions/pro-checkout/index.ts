// Starts Throttle Pro for the signed-in app rider: a Paddle transaction for
// the yearly subscription ($15.99/yr, cancel any time), tagged with their
// account, and the page that opens Paddle's checkout for it (pro.html).
// Pro switches on when Paddle confirms (paddle-webhook ->
// apply_paddle_subscription).
//
// Called from the app with the rider's Supabase session (JWT verified).
//
// Secrets: PADDLE_API_KEY, SITE_URL (where pro.html is served, e.g.
// https://throttle.app), optional PADDLE_PRO_PRICE_ID (a yearly price in
// Paddle; without it a $15.99/year price is sent with the transaction).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { paddleApi } from "../_shared/paddle.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

const PRICE_ID = Deno.env.get("PADDLE_PRO_PRICE_ID") ?? "";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
const PRO_CENTS = 1599;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  if (!Deno.env.get("PADDLE_API_KEY") || !SITE_URL) {
    console.error("pro-checkout: PADDLE_API_KEY or SITE_URL is not set");
    return json(req, { error: "Checkout isn't set up yet. Please try again later." }, 500);
  }

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await db.auth.getUser(token);
  const user = auth?.user;
  if (authErr || !user) return json(req, { error: "Sign in first." }, 401);

  // Already Pro through Paddle: send them to manage it instead.
  const { data: sub } = await db.from("pro_subscriptions")
    .select("status, current_period_end").eq("user_id", user.id).maybeSingle();
  if (sub && ["active", "trialing", "past_due"].includes(sub.status)) {
    return json(req, { already_pro: true });
  }

  try {
    const item = PRICE_ID
      ? { price_id: PRICE_ID, quantity: 1 }
      : {
        quantity: 1,
        price: {
          description: "Throttle Pro, yearly",
          name: "Throttle Pro",
          billing_cycle: { interval: "year", frequency: 1 },
          unit_price: { amount: String(PRO_CENTS), currency_code: "USD" },
          product: {
            name: "Throttle Pro",
            description: "Speed and elevation charts, every ride card, an unlimited garage and following riders. Billed yearly, cancel any time.",
            tax_category: "standard",
          },
        },
      };
    const txn = await paddleApi("/transactions", {
      method: "POST",
      body: {
        items: [item],
        collection_mode: "automatic",
        // Copied onto the subscription, so its events find the rider.
        custom_data: { plan: "pro", user_id: user.id },
      },
    });
    const params = new URLSearchParams({ txn: txn.id });
    if (user.email) params.set("email", user.email);
    return json(req, { transaction_id: txn.id, checkout_url: `${SITE_URL}/pro?${params}` });
  } catch (err) {
    console.error("pro-checkout: Paddle error", err);
    return json(req, { error: "Couldn't open checkout. Please try again." }, 502);
  }
});
