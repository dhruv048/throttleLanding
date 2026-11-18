// Public settings for the landing page. Everything here ships to the browser,
// so only publishable values belong here (never the Paddle API key or the
// Supabase service-role key; those live in the edge functions' secrets).
window.THROTTLE_CONFIG = {
  // Same Supabase project as the Flutter app (lib/config/env.dart).
  supabaseUrl: "https://lioglcwbfrjdyrcgwfut.supabase.co",
  supabasePublishableKey: "sb_publishable_iCLDmvmrRzZT0yrMcbVbXQ_CTMyPS07",

  // Paddle client-side token (Paddle > Developer tools > Authentication).
  // "test_…" uses the sandbox, "live_…" takes real payments. Safe to publish.
  paddleClientToken: "test_f9123dc8a20ca6ec37b7caf7960",

  // What pre-registration costs (one-time), and what Pro costs after launch. The charged amount is set in Paddle / paddle-checkout;
  // keep these in step with it. The struck-through price hides while empty.
  offerPrice: "$9.99",
  launchPrice: "$49.99/yr",
  launchPriceText: "$49.99 a year",

  // The hero shows "N founding riders already in" once N reaches this.
  showCountFrom: 10,

  // Shown as a Contact link in the footer when set.
  contactEmail: "blackstellarholdings@gmail.com",
};
