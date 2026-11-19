// Paddle webhook: keeps public.pre_enrollments, and Throttle Pro
// subscriptions (pro_subscriptions, pro_grants, profiles.pro_until), in step
// with Paddle.
//
// Subscribe the notification destination to:
//   transaction.paid
//   transaction.completed
//   adjustment.created
//   adjustment.updated
//   subscription.created
//   subscription.activated
//   subscription.updated
//   subscription.canceled
//   subscription.past_due
//   subscription.paused
//   subscription.resumed
//
// Secrets: PADDLE_WEBHOOK_SECRET (the destination's secret key). Deploy with
// --no-verify-jwt (Paddle can't send a Supabase token; its signature is
// checked instead).
//
// Paddle ids live in the stripe_* columns (no schema change needed):
// stripe_checkout_session_id and stripe_payment_intent_id hold the
// transaction id (txn_…), stripe_customer_id holds the customer id (ctm_…).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { clientIp, ipInCidrs, paddleWebhookCidrs, verifyPaddleSignature } from "../_shared/paddle.ts";

const WEBHOOK_SECRET = Deno.env.get("PADDLE_WEBHOOK_SECRET") ?? "";
// Deliveries are only accepted from Paddle's published IPs (sandbox or live,
// matching the API key). Set PADDLE_IP_ALLOWLIST=off to switch this off in an
// emergency; the signature check still runs either way.
const IP_CHECK = (Deno.env.get("PADDLE_IP_ALLOWLIST") ?? "on").toLowerCase() !== "off";

const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

// A Throttle Pro subscription changed: its paid period (or its end) becomes
// the rider's Pro time. The rider is in custom_data, set by pro-checkout and
// copied by Paddle from the first transaction onto the subscription.
// deno-lint-ignore no-explicit-any
async function applyProSubscription(sub: any) {
  const userId = sub.custom_data?.user_id;
  if (sub.custom_data?.plan !== "pro" || !userId) return;
  // A cancellation takes effect at the period's end (Pro runs till then);
  // an ended subscription stopped when it was cancelled.
  const scheduledCancel = sub.scheduled_change?.action === "cancel"
    ? sub.scheduled_change.effective_at
    : null;
  const cancelAt = sub.status === "canceled" ? (sub.canceled_at ?? new Date().toISOString()) : scheduledCancel;
  const { error } = await db.rpc("apply_paddle_subscription", {
    p_user: userId,
    p_subscription: sub.id,
    p_customer: sub.customer_id ?? null,
    p_status: sub.status,
    p_period_end: sub.current_billing_period?.ends_at ?? null,
    p_cancel_at: cancelAt,
  });
  if (error) throw error;
  console.log(`paddle-webhook: Pro ${sub.status} for ${userId} (${sub.id})`);
}

// Payment went through: mark the pre-enrollment paid and reserve its username
// (complete_pre_enrollment). Safe to run twice: a paid row is left alone. If
// someone else's payment for the same name landed first, the payment still
// counts and the rider picks another name in the app.
// deno-lint-ignore no-explicit-any
async function markPaid(txn: any) {
  // Pro payments are handled through their subscription's events.
  if (txn.custom_data?.plan === "pro") return;
  let enrollmentId: string | null = txn.custom_data?.enrollment_id ?? null;
  if (!enrollmentId) {
    const { data, error } = await db.from("pre_enrollments").select("id")
      .eq("stripe_checkout_session_id", txn.id).maybeSingle();
    if (error) throw error;
    enrollmentId = data?.id ?? null;
  }
  if (!enrollmentId) {
    console.warn(`paddle-webhook: no pre-enrollment for transaction ${txn.id}`);
    return;
  }
  const total = Number.parseInt(txn.details?.totals?.grand_total ?? "", 10);
  const { data, error } = await db.rpc("complete_pre_enrollment", {
    p_id: enrollmentId,
    p_session_id: txn.id,
    p_payment_intent: txn.id,
    p_customer: txn.customer_id ?? null,
    p_amount_cents: Number.isFinite(total) ? total : null,
    p_currency: typeof txn.currency_code === "string" ? txn.currency_code.toLowerCase() : null,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (result?.status === "paid_username_taken") {
    console.warn(`paddle-webhook: ${enrollmentId} paid but its username was already taken; flagged for the rider to pick another`);
  } else if (result?.status === "not_found") {
    console.error(`paddle-webhook: pre-enrollment ${enrollmentId} not found`);
  }
}

// An approved full refund or a chargeback cancels the pre-registration.
// "Full" means Paddle says type "full", or the refunded total covers what the
// rider paid (Paddle doesn't always set type).
// deno-lint-ignore no-explicit-any
async function handleAdjustment(adj: any) {
  const { data: row, error: findErr } = await db.from("pre_enrollments")
    .select("id, status, amount_cents")
    .eq("stripe_checkout_session_id", adj.transaction_id).maybeSingle();
  if (findErr) throw findErr;
  if (!row) {
    console.warn(`paddle-webhook: no pre-enrollment for adjustment ${adj.id} (transaction ${adj.transaction_id})`);
    return;
  }

  const refunded = Number.parseInt(adj.totals?.total ?? "", 10);
  const coversPayment = Number.isFinite(refunded) && row.amount_cents != null && refunded >= row.amount_cents;
  const fullRefund = adj.action === "refund" && adj.status === "approved" && (adj.type === "full" || coversPayment);
  const chargeback = adj.action === "chargeback";
  if (!fullRefund && !chargeback) {
    console.log(`paddle-webhook: adjustment ${adj.id} left alone (action=${adj.action}, status=${adj.status}, type=${adj.type}, total=${adj.totals?.total}, paid=${row.amount_cents})`);
    return;
  }

  const { error } = await db
    .from("pre_enrollments")
    .update({ status: "refunded", refunded_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) throw error;
  console.log(`paddle-webhook: ${row.id} marked refunded (adjustment ${adj.id})`);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  if (IP_CHECK) {
    let cidrs: string[];
    try {
      cidrs = await paddleWebhookCidrs();
    } catch (err) {
      // Can't tell who's calling: ask Paddle to retry later rather than guess.
      console.error("paddle-webhook:", err);
      return new Response("Try again later", { status: 503 });
    }
    const ip = clientIp(req);
    if (!ip || !ipInCidrs(ip, cidrs)) {
      console.warn(`paddle-webhook: rejected delivery from ${ip ?? "unknown IP"} (cf-connecting-ip=${req.headers.get("cf-connecting-ip")}, x-real-ip=${req.headers.get("x-real-ip")}, x-forwarded-for=${req.headers.get("x-forwarded-for")})`);
      return new Response("Forbidden", { status: 403 });
    }
  }

  const payload = await req.text();
  const ok = await verifyPaddleSignature(payload, req.headers.get("paddle-signature"), WEBHOOK_SECRET);
  if (!ok) {
    console.error("paddle-webhook: bad or missing signature");
    return new Response("Bad signature", { status: 400 });
  }

  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  try {
    switch (event.event_type) {
      case "transaction.paid":
      case "transaction.completed":
        await markPaid(event.data);
        break;

      case "adjustment.created":
      case "adjustment.updated":
        await handleAdjustment(event.data);
        break;

      case "subscription.created":
      case "subscription.activated":
      case "subscription.updated":
      case "subscription.canceled":
      case "subscription.past_due":
      case "subscription.paused":
      case "subscription.resumed":
        await applyProSubscription(event.data);
        break;

      default:
        // Not an event we use; acknowledge so Paddle doesn't retry.
        break;
    }
  } catch (err) {
    // Non-2xx makes Paddle retry, so a database blip doesn't lose a payment.
    console.error(`paddle-webhook: failed to handle ${event.event_type}`, err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
