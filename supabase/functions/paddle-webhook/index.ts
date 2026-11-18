// Paddle webhook: keeps public.pre_enrollments in step with Paddle.
//
// Subscribe the notification destination to:
//   transaction.paid
//   transaction.completed
//   adjustment.created
//   adjustment.updated
//
// Secrets: PADDLE_WEBHOOK_SECRET (the destination's secret key). Deploy with
// --no-verify-jwt (Paddle can't send a Supabase token; its signature is
// checked instead).
//
// Paddle ids live in the stripe_* columns (no schema change needed):
// stripe_checkout_session_id and stripe_payment_intent_id hold the
// transaction id (txn_…), stripe_customer_id holds the customer id (ctm_…).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { verifyPaddleSignature } from "../_shared/paddle.ts";

const WEBHOOK_SECRET = Deno.env.get("PADDLE_WEBHOOK_SECRET") ?? "";

const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

// Payment went through: mark the pre-enrollment paid and reserve its username
// (complete_pre_enrollment). Safe to run twice: a paid row is left alone. If
// someone else's payment for the same name landed first, the payment still
// counts and the rider picks another name in the app.
// deno-lint-ignore no-explicit-any
async function markPaid(txn: any) {
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

// A full refund or a chargeback cancels the pre-registration.
// deno-lint-ignore no-explicit-any
async function handleAdjustment(adj: any) {
  const fullRefund = adj.action === "refund" && adj.status === "approved" && adj.type === "full";
  const chargeback = adj.action === "chargeback";
  if (!fullRefund && !chargeback) return;
  const { error } = await db
    .from("pre_enrollments")
    .update({ status: "refunded", refunded_at: new Date().toISOString() })
    .eq("stripe_checkout_session_id", adj.transaction_id);
  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

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
