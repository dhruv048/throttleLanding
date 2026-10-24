// Public settings for the landing page. Everything here ships to the browser,
// so only publishable values belong here (never the Stripe secret key or the
// Supabase service-role key; those live in the edge functions' secrets).
window.THROTTLE_CONFIG = {
  // Same Supabase project as the Flutter app (lib/config/env.dart).
  supabaseUrl: "https://lioglcwbfrjdyrcgwfut.supabase.co",
  supabasePublishableKey: "sb_publishable_iCLDmvmrRzZT0yrMcbVbXQ_CTMyPS07",

  // What pre-registration costs (one-time), and what Pro costs after launch. The charged amount is set in Stripe / create-checkout;
  // keep these in step with it. The struck-through price hides while empty.
  offerPrice: "$1.99",
  launchPrice: "$15.99/yr",
  launchPriceText: "$15.99 a year",

  // The hero shows "N founding riders already in" once N reaches this.
  showCountFrom: 10,

  // Shown as a Contact link in the footer when set.
  contactEmail: "",
};
