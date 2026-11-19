// Throttle Pro checkout, opened from the app (pro-checkout makes the
// transaction and sends the rider here with ?txn=…). Paddle's overlay takes
// the payment; Pro switches on in the app when Paddle tells Supabase
// (paddle-webhook). Then this page sends the rider back to the app.
(function () {
  const cfg = window.THROTTLE_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const txn = params.get("txn");
  const email = params.get("email");
  const title = document.getElementById("pro-title");
  const text = document.getElementById("pro-text");
  const back = document.getElementById("pro-back");
  const retry = document.getElementById("pro-retry");

  function say(t, body) {
    title.textContent = t;
    if (body !== undefined) text.textContent = body;
  }

  function done() {
    say("You're Pro. 🎉", "Head back to Throttle: everything's unlocked. It can take a few seconds to show.");
    retry.hidden = true;
    back.hidden = false;
    // Straight back to the app; the button stays in case the switch is blocked.
    setTimeout(() => { location.href = back.href; }, 1200);
  }

  if (!txn) {
    say("Upgrade from the app", "Open Throttle, go to your profile and tap Upgrade to Pro.");
    return;
  }
  if (!window.Paddle || !cfg.paddleClientToken) {
    say("Checkout isn't available", "Please try again in a moment.");
    return;
  }
  if (cfg.paddleClientToken.startsWith("test_")) window.Paddle.Environment.set("sandbox");
  window.Paddle.Initialize({
    token: cfg.paddleClientToken,
    eventCallback: (e) => {
      if (e.name === "checkout.completed") {
        setTimeout(() => { window.Paddle.Checkout.close(); done(); }, 1500);
      } else if (e.name === "checkout.closed") {
        say("Checkout closed", "Nothing was charged. Open it again, or head back to the app.");
        retry.hidden = false;
        back.hidden = false;
      }
    },
  });

  function open() {
    say("Throttle Pro", "$15.99 a year. No commitment, cancel any time.");
    retry.hidden = true;
    window.Paddle.Checkout.open({
      transactionId: txn,
      customer: email ? { email } : undefined,
      settings: { displayMode: "overlay", theme: "light", allowLogout: false },
    });
  }
  retry.addEventListener("click", open);
  open();
})();
