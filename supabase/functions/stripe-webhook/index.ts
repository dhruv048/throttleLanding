// Stripe webhook: keeps public.pre_enrollments in step with Stripe.
//
// Subscribe the endpoint to:
//   checkout.session.completed
//   checkout.session.async_payment_succeeded
//   checkout.session.async_payment_failed
//   checkout.session.expired
//   charge.refunded
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET. Deploy with
// --no-verify-jwt (Stripe can't send a Supabase token; the Stripe signature
// is checked instead).
import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : v?.id ?? null);

// Finds the row for a Checkout Session: by our id in metadata, then by session id.
async function updateForSession(
  session: Stripe.Checkout.Session,
  patch: Record<string, unknown>,
  onlyIfPending = false,
) {
  const enrollmentId = session.metadata?.enrollment_id ?? session.client_reference_id;
  let q = db.from("pre_enrollments").update(patch);
  q = enrollmentId ? q.eq("id", enrollmentId) : q.eq("stripe_checkout_session_id", session.id);
  if (onlyIfPending) q = q.eq("status", "pending");
  const { error } = await q;
  if (error) throw error;
}

// Payment succeeded: mark the pre-enrollment paid and reserve its username
// (complete_pre_enrollment). This is the moment a username becomes the
// rider's; if someone else's payment for the same name landed first, the
// payment still counts and the rider picks another name in the app.
async function markPaid(session: Stripe.Checkout.Session) {
  if (session.payment_status !== "paid") return; // async methods confirm later
  let enrollmentId = session.metadata?.enrollment_id ?? session.client_reference_id ?? null;
  if (!enrollmentId) {
    const { data, error } = await db.from("pre_enrollments").select("id")
      .eq("stripe_checkout_session_id", session.id).maybeSingle();
    if (error) throw error;
    enrollmentId = data?.id ?? null;
  }
  if (!enrollmentId) {
    console.error(`stripe-webhook: no pre-enrollment for session ${session.id}`);
    return;
  }
  const { data, error } = await db.rpc("complete_pre_enrollment", {
    p_id: enrollmentId,
    p_session_id: session.id,
    p_payment_intent: idOf(session.payment_intent),
    p_customer: idOf(session.customer),
    p_amount_cents: session.amount_total,
    p_currency: session.currency,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (result?.status === "paid_username_taken") {
    console.warn(`stripe-webhook: ${enrollmentId} paid but its username was already taken; flagged for the rider to pick another`);
  } else if (result?.status === "not_found") {
    console.error(`stripe-webhook: pre-enrollment ${enrollmentId} not found`);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const signature = req.headers.get("stripe-signature");
  if (!signature || !WEBHOOK_SECRET) return new Response("Missing signature", { status: 400 });

  const payload = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch (err) {
    console.error("stripe-webhook: bad signature", err);
    return new Response("Bad signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await markPaid(event.data.object);
        break;

      case "checkout.session.async_payment_failed":
        await updateForSession(event.data.object, { status: "failed" }, true);
        break;

      case "checkout.session.expired":
        await updateForSession(event.data.object, { status: "expired" }, true);
        break;

      case "charge.refunded": {
        const charge = event.data.object;
        const paymentIntent = idOf(charge.payment_intent);
        // Only a full refund cancels the pre-registration.
        if (paymentIntent && charge.amount_refunded >= charge.amount) {
          const { error } = await db
            .from("pre_enrollments")
            .update({ status: "refunded", refunded_at: new Date().toISOString() })
            .eq("stripe_payment_intent_id", paymentIntent);
          if (error) throw error;
        }
        break;
      }

      default:
        // Not an event we use; acknowledge so Stripe doesn't retry.
        break;
    }
  } catch (err) {
    // Non-2xx makes Stripe retry, so a database blip doesn't lose a payment.
    console.error(`stripe-webhook: failed to handle ${event.type}`, err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
