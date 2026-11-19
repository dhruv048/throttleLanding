// "Manage subscription": a link to Paddle's customer portal for the
// signed-in rider's Pro subscription, where they cancel (any time), change
// card or see invoices. Called from the app with the rider's session.
//
// Secrets: PADDLE_API_KEY.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { paddleApi } from "../_shared/paddle.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await db.auth.getUser(token);
  const user = auth?.user;
  if (!user) return json(req, { error: "Sign in first." }, 401);

  const { data: sub } = await db.from("pro_subscriptions")
    .select("paddle_customer_id, paddle_subscription_id").eq("user_id", user.id).maybeSingle();
  if (!sub?.paddle_customer_id) return json(req, { error: "No subscription to manage." }, 404);

  try {
    const session = await paddleApi(`/customers/${sub.paddle_customer_id}/portal-sessions`, {
      method: "POST",
      body: sub.paddle_subscription_id ? { subscription_ids: [sub.paddle_subscription_id] } : {},
    });
    const url = session.urls?.general?.overview;
    return json(req, { url });
  } catch (err) {
    console.error("pro-portal: Paddle error", err);
    return json(req, { error: "Couldn't open your subscription. Please try again." }, 502);
  }
});
