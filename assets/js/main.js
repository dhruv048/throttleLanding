/* Throttle landing page. Plain JS, no build step. */
(() => {
  "use strict";

  const cfg = window.THROTTLE_CONFIG || {};
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const configured =
    typeof cfg.supabaseUrl === "string" &&
    cfg.supabaseUrl.startsWith("https://") &&
    !/YOUR_/.test(cfg.supabaseUrl + cfg.supabasePublishableKey);

  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  /* ------------------------------------------------------------ Config text */
  if (cfg.offerPrice) $$("[data-price]").forEach((el) => (el.textContent = cfg.offerPrice));
  $$("[data-launch-price]").forEach((el) => {
    if (cfg.launchPrice) el.textContent = cfg.launchPrice;
    else el.hidden = true;
  });
  // "88% off" badge, worked out from the two prices.
  const num = (p) => parseFloat(String(p || "").replace(/[^0-9.]/g, ""));
  const off = Math.round((1 - num(cfg.offerPrice) / num(cfg.launchPrice)) * 100);
  $$("[data-discount]").forEach((el) => {
    if (off > 0 && off < 100) { el.textContent = `${off}% off`; el.hidden = false; }
  });
  if (cfg.launchPriceText) $$("[data-launch-text]").forEach((el) => (el.textContent = cfg.launchPriceText));
  const contact = $("[data-contact]");
  if (contact && cfg.contactEmail) { contact.href = `mailto:${cfg.contactEmail}`; contact.hidden = false; }
  $$("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));

  /* ------------------------------------------------------------ Light / dark */
  const root = document.documentElement;
  const themeBtn = $("#themeToggle");
  const themeMeta = $('meta[name="theme-color"]');
  const applyTheme = (t) => {
    root.setAttribute("data-theme", t);
    themeBtn.setAttribute("aria-label", t === "light" ? "Switch to dark mode" : "Switch to light mode");
    themeMeta.setAttribute("content", t === "light" ? "#f7f5f1" : "#0d0d0f");
  };
  applyTheme(root.getAttribute("data-theme") === "dark" ? "dark" : "light");
  themeBtn.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    applyTheme(next);
    try { localStorage.setItem("throttle_theme", next); } catch { /* private mode */ }
  });

  /* ------------------------------------------------------------ Campaign source */
  // Remember where the visitor came from, so the admin panel can see which
  // posts and campaigns bring founding riders.
  const params = new URLSearchParams(location.search);
  const sourceKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "ref"];
  if (sourceKeys.some((k) => params.has(k))) {
    const src = {};
    sourceKeys.forEach((k) => params.get(k) && (src[k] = params.get(k).slice(0, 100)));
    store.set("throttle_source", JSON.stringify(src));
  }
  if (!store.get("throttle_referrer") && document.referrer && !document.referrer.startsWith(location.origin)
      && !/^https:\/\/[^/]*stripe\.com\//.test(document.referrer)) {
    store.set("throttle_referrer", document.referrer.slice(0, 300));
  }

  /* ------------------------------------------------------------ Nav + sticky CTA */
  const nav = $("#nav");
  const sticky = $("#stickyCta");
  const heroCtas = $(".hero__ctas");
  const enrollSection = $("#enroll");
  let heroVisible = true;
  let enrollVisible = false;
  const syncSticky = () => {
    const on = !heroVisible && !enrollVisible;
    sticky.classList.toggle("is-on", on);
    sticky.setAttribute("aria-hidden", String(!on));
    $("a", sticky).tabIndex = on ? 0 : -1;
  };
  const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 12);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => { heroVisible = e.isIntersecting; syncSticky(); }).observe(heroCtas);
    new IntersectionObserver(([e]) => { enrollVisible = e.isIntersecting; syncSticky(); }, { threshold: 0.15 }).observe(enrollSection);
  }

  // Every CTA lands on the form with the email field ready.
  $$("[data-cta]").forEach((a) =>
    a.addEventListener("click", () => setTimeout(() => $("#email").focus({ preventScroll: true }), reduceMotion ? 0 : 650))
  );

  /* ------------------------------------------------------------ Reveal on scroll */
  const revealEls = $$(".reveal");
  if ("IntersectionObserver" in window && !reduceMotion) {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-in");
        io.unobserve(e.target);
        if (e.target.classList.contains("tile--track")) startTrackDot();
      }),
      { threshold: 0.18, rootMargin: "0px 0px -6% 0px" }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("is-in"));
  }

  /* ------------------------------------------------------------ Hero: cards, gauge, clock */
  const fan = $(".fan");
  if (!reduceMotion) {
    fan.classList.add("is-loading");
    requestAnimationFrame(() => requestAnimationFrame(() => fan.classList.remove("is-loading")));
  }

  const TOP_SPEED = 194;
  const GAUGE_MAX = 220;
  const speedEl = $("[data-speed]");
  const gaugeFill = $(".gauge__fill");
  const countUp = (el, to, ms, done) => {
    if (reduceMotion) { el.textContent = to; done && done(); return; }
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(to * eased).toLocaleString();
      p < 1 ? requestAnimationFrame(step) : done && done();
    };
    requestAnimationFrame(step);
  };
  setTimeout(() => {
    gaugeFill.style.strokeDashoffset = String(100 - (TOP_SPEED / GAUGE_MAX) * 100);
    countUp(speedEl, TOP_SPEED, 1600);
  }, reduceMotion ? 0 : 500);

  const clock = $("[data-clock]");
  let secs = 13 * 60 + 42;
  const pad = (n) => String(n).padStart(2, "0");
  setInterval(() => {
    secs += 1;
    clock.textContent = `${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}`;
  }, 1000);

  const kudosEl = $("[data-kudos]");
  let kudos = 47;
  if (!reduceMotion) setInterval(() => { kudos += 1; kudosEl.textContent = kudos; }, 2600);

  /* ------------------------------------------------------------ Tracking tile: rider dot */
  // Moves a dot along the route as it draws, then keeps riding it on a loop.
  let dotStarted = false;
  function startTrackDot() {
    if (dotStarted || reduceMotion) return;
    dotStarted = true;
    const viz = $(".trackviz");
    const svg = $("svg", viz);
    const path = $(".route", viz);
    const dot = $(".trackviz__dot", viz);
    const len = path.getTotalLength();
    const DRAW_MS = 4500;
    const LOOP_MS = 7000;
    const t0 = performance.now() + 200;
    const ease = (p) => 1 - Math.pow(1 - p, 3);
    const place = (frac) => {
      const pt = path.getPointAtLength(len * frac);
      const m = svg.getScreenCTM();
      const box = viz.getBoundingClientRect();
      if (!m) return;
      dot.style.transform = `translate(${pt.x * m.a + m.e - box.left}px, ${pt.y * m.d + m.f - box.top}px)`;
    };
    const tick = (now) => {
      const t = now - t0;
      if (t < 0) { requestAnimationFrame(tick); return; }
      dot.style.opacity = "1";
      if (t < DRAW_MS) place(ease(t / DRAW_MS));
      else place(((t - DRAW_MS) % LOOP_MS) / LOOP_MS);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------ Marquee */
  const track = $("[data-marquee]");
  if (track) track.innerHTML += track.innerHTML;

  /* ------------------------------------------------------------ Card rail */
  const rail = $("#rail");
  $$("[data-rail]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const card = $("figure", rail);
      const by = (card ? card.getBoundingClientRect().width + 18 : 300) * 2;
      rail.scrollBy({ left: by * Number(btn.dataset.rail), behavior: reduceMotion ? "auto" : "smooth" });
    })
  );

  /* ------------------------------------------------------------ Supabase helpers */
  const api = (path, body) =>
    fetch(`${cfg.supabaseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.supabasePublishableKey },
      body: JSON.stringify(body || {}),
    });

  /* ------------------------------------------------------------ Visit + form tracking */
  // Counts visits and how far people get with the form, for the admin panel
  // (public.site_events) and Google Analytics. Never sends what was typed,
  // only which steps happened and which fields were filled.
  const local = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };
  const newId = () => (window.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36));
  const visitorId = local.get("throttle_vid") || newId();
  local.set("throttle_vid", visitorId);
  const sessionId = store.get("throttle_sid") || newId();
  store.set("throttle_sid", sessionId);
  const device = window.matchMedia("(pointer: coarse)").matches ? "mobile" : "desktop";
  const priceValue = num(cfg.offerPrice) || undefined;
  // Our event names -> Google Analytics event names (page views GA counts itself).
  const GA_EVENT = {
    form_view: "enroll_form_view",
    form_start: "enroll_form_start",
    field_filled: "enroll_field_filled",
    form_submit: "enroll_submit",
    form_error: "enroll_error",
    checkout_open: "begin_checkout",
    checkout_cancel: "checkout_cancelled",
    checkout_success: "purchase",
  };
  const tracked = new Set();
  // Open the site once with ?notrack=1 on your own devices so your visits
  // don't count (?notrack=0 undoes it).
  if (params.get("notrack") === "1") local.set("throttle_no_track", "1");
  if (params.get("notrack") === "0") local.set("throttle_no_track", "0");
  const skipTracking = local.get("throttle_no_track") === "1";
  const logEvent = (event, detail = {}, gaParams = {}) => {
    if (skipTracking) return Promise.resolve();
    const key = event + JSON.stringify(detail);
    if (event !== "page_view") {
      if (tracked.has(key)) return Promise.resolve();
      tracked.add(key);
    }
    if (GA_EVENT[event] && typeof window.gtag === "function") {
      try { window.gtag("event", GA_EVENT[event], { ...detail, ...gaParams }); } catch { /* ignore */ }
    }
    if (!configured || navigator.webdriver) return Promise.resolve();
    let source = {};
    try { source = JSON.parse(store.get("throttle_source") || "{}"); } catch { /* ignore */ }
    const referrer = store.get("throttle_referrer");
    if (referrer) source.referrer = referrer;
    return fetch(`${cfg.supabaseUrl}/rest/v1/rpc/track_event`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", apikey: cfg.supabasePublishableKey },
      body: JSON.stringify({
        p_visitor: visitorId, p_session: sessionId, p_event: event, p_page: location.pathname,
        p_detail: detail, p_source: source, p_device: device,
      }),
    }).catch(() => {});
  };
  logEvent("page_view");

  // Pre-registered rider count (shown only once it's worth showing).
  if (configured) {
    api("/rest/v1/rpc/pre_enrollment_count")
      .then((r) => (r.ok ? r.json() : null))
      .then((n) => {
        if (typeof n !== "number" || n < (cfg.showCountFrom ?? 10)) return;
        const box = $("#heroCount");
        box.hidden = false;
        countUp($("[data-count]", box), n, 1200);
      })
      .catch(() => {});
  }

  /* ------------------------------------------------------------ Enroll form */
  const form = $("#enrollForm");
  const btn = $("#enrollBtn");
  const msg = $("#formMsg");
  const emailInput = form.elements.email;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const say = (text, ok = false) => { msg.textContent = text; msg.classList.toggle("is-ok", ok); };
  emailInput.addEventListener("input", () => { emailInput.removeAttribute("aria-invalid"); if (!msg.classList.contains("is-ok")) say(""); });

  // Funnel steps: saw the form, typed into it, filled each field.
  if ("IntersectionObserver" in window) {
    const seen = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { logEvent("form_view"); seen.disconnect(); }
    }, { threshold: 0.4 });
    seen.observe(form);
  }
  form.addEventListener("input", () => logEvent("form_start"));
  emailInput.addEventListener("change", () => {
    if (EMAIL_RE.test(emailInput.value.trim())) logEvent("field_filled", { field: "email" });
  });
  if (form.elements.bike) form.elements.bike.addEventListener("change", () => {
    if (form.elements.bike.value.trim()) logEvent("field_filled", { field: "bike" });
  });

  /* Username reservation (only on pages whose form has a username field). The
     database decides availability: username_status() checks other riders'
     profiles and paid reservations; the checkout re-checks it, and the name
     becomes the rider's when the payment succeeds. */
  const userInput = form.elements.username || null;
  const userField = userInput ? userInput.closest(".field--handle") : null;
  const userMsg = userField ? userField.querySelector(".handle__msg") : null;
  const USER_HINT = userMsg ? userMsg.textContent : "";
  const USER_RE = /^[a-z0-9_]{3,24}$/;
  let userState = "empty";   // empty | invalid | checking | available | taken | reserved | error
  let userChecked = "";      // the value the state belongs to
  let userTimer = 0;
  let userSeq = 0;

  const setUser = (state, text) => {
    userState = state;
    if (!userField) return;
    userField.dataset.state = state;
    userInput.setAttribute("aria-invalid", String(["invalid", "taken", "reserved"].includes(state)));
    userMsg.textContent = text;
    if (state === "available") logEvent("field_filled", { field: "username" });
  };
  const userText = {
    empty: () => USER_HINT,
    invalid: (n) => (n.length < 3 ? "At least 3 characters." : "Use lowercase letters, numbers and underscores (3-24)."),
    checking: () => "Checking…",
    available: (n) => `@${n} is available. It's yours once you pre-register.`,
    taken: (n) => `@${n} is already taken. Try another.`,
    reserved: (n) => `@${n} is reserved by another rider. Try another.`,
    error: () => "Couldn't check right now. We'll check again when you pre-register.",
  };

  async function checkUsername(name) {
    const seq = ++userSeq;
    if (!USER_RE.test(name)) { setUser(name ? "invalid" : "empty", (name ? userText.invalid : userText.empty)(name)); userChecked = name; return userState; }
    if (!configured) { setUser("available", userText.available(name)); userChecked = name; return userState; }
    setUser("checking", userText.checking());
    try {
      const email = emailInput.value.trim().toLowerCase();
      const res = await api("/rest/v1/rpc/username_status", { p_username: name, p_email: EMAIL_RE.test(email) ? email : null });
      const status = res.ok ? await res.json() : "error";
      if (seq !== userSeq) return userState; // a newer check is running
      const state = ["available", "taken", "reserved", "invalid"].includes(status) ? status : "error";
      setUser(state, userText[state](name));
    } catch {
      if (seq !== userSeq) return userState;
      setUser("error", userText.error());
    }
    userChecked = name;
    return userState;
  }

  if (userInput) {
    userInput.addEventListener("input", () => {
      // Keep it in the app's format as they type: lowercase, no spaces or symbols.
      const clean = userInput.value.toLowerCase().replace(/^@+/, "").replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 24);
      if (clean !== userInput.value) {
        const caret = Math.max(0, (userInput.selectionStart || clean.length) - (userInput.value.length - clean.length));
        userInput.value = clean;
        userInput.setSelectionRange(caret, caret);
      }
      clearTimeout(userTimer);
      if (!clean) { userSeq++; setUser("empty", userText.empty()); userChecked = ""; return; }
      if (!USER_RE.test(clean)) { userSeq++; setUser("invalid", userText.invalid(clean)); userChecked = clean; return; }
      setUser("checking", userText.checking());
      userTimer = setTimeout(() => checkUsername(clean), 350);
    });
    // A rider re-trying their own unfinished checkout shouldn't see their name as reserved.
    emailInput.addEventListener("change", () => { if (userInput.value) checkUsername(userInput.value); });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim().toLowerCase();
    const bike = form.elements.bike ? form.elements.bike.value.trim() : "";
    const username = userInput ? userInput.value.trim() : "";

    if (!EMAIL_RE.test(email)) {
      emailInput.setAttribute("aria-invalid", "true");
      emailInput.focus();
      say("Enter a valid email so we can attach Pro to your account.");
      logEvent("form_error", { reason: "invalid_email" });
      return;
    }
    if (!configured) { say("Checkout isn't connected yet. Add your Supabase details to assets/js/config.js."); return; }
    if (userInput) {
      clearTimeout(userTimer);
      const state = userChecked === username && userState !== "checking" ? userState : await checkUsername(username);
      if (!["available", "error"].includes(state)) {
        if (state === "empty") setUser("invalid", "Pick a username to reserve.");
        userInput.focus();
        say("");
        logEvent("form_error", { reason: `username_${state}` });
        return;
      }
    }

    logEvent("form_submit");
    btn.classList.add("is-busy");
    btn.disabled = true;
    say("");

    let source = {};
    try { source = JSON.parse(store.get("throttle_source") || "{}"); } catch { /* ignore */ }
    const referrer = store.get("throttle_referrer");
    if (referrer) source.referrer = referrer;

    try {
      const res = await api("/functions/v1/create-checkout", {
        email, bike: bike || null, username: username || null, source, return_to: location.pathname,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        store.set("throttle_email", email);
        store.set("throttle_username", username);
        // Give the event a moment to leave before the page changes.
        await Promise.race([
          logEvent("checkout_open", {}, { currency: "USD", value: priceValue }),
          new Promise((r) => setTimeout(r, 500)),
        ]);
        window.location.assign(data.url);
        return; // keep the spinner while Stripe loads
      }
      logEvent("form_error", {
        reason: data.already_enrolled ? "already_registered" : data.username_taken ? "username_taken" : "server_error",
      });
      if (data.already_enrolled) {
        say(data.username
          ? `You're already pre-registered as @${data.username} with this email. Nothing more to pay.`
          : "You're already pre-registered with this email. Nothing more to pay.", true);
      } else if (data.username_taken && userInput) {
        setUser("taken", userText.taken(username));
        userInput.focus();
        say("");
      } else {
        say(data.error || "Couldn't start checkout. Please try again in a moment.");
      }
    } catch {
      say("Network hiccup. Check your connection and try again.");
      logEvent("form_error", { reason: "network" });
    }
    btn.classList.remove("is-busy");
    btn.disabled = false;
  });

  /* ------------------------------------------------------------ Back from Stripe */
  const overlay = $("#overlay");
  const toast = $("#toast");
  const cleanUrl = () => history.replaceState(null, "", location.pathname + location.hash);

  if (params.get("enrolled")) {
    logEvent("checkout_success", {}, {
      transaction_id: params.get("enrolled").slice(0, 100), currency: "USD", value: priceValue,
    });
    cleanUrl();
    const email = store.get("throttle_email");
    const handle = store.get("throttle_username");
    if (email && handle) $("#overlayText").textContent =
      `@${handle} is yours. We'll email ${email} the moment Throttle is ready. Sign in to the app with that email and your username will be waiting.`;
    else if (email) $("#overlayText").textContent =
      `Your spot is saved. We'll email ${email} the moment Throttle is ready. Sign in to the app with that email to claim Pro.`;
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    $("#overlayClose").focus();
    if (!reduceMotion) confetti($("#confetti"));
  } else if (params.get("cancelled")) {
    logEvent("checkout_cancel");
    cleanUrl();
    showToast("Checkout cancelled. Your spot isn't locked in yet.");
  }

  const closeOverlay = () => { overlay.hidden = true; document.body.style.overflow = ""; };
  $("#overlayClose").addEventListener("click", closeOverlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeOverlay(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) closeOverlay(); });

  function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    setTimeout(() => (toast.hidden = true), 5000);
  }

  /* ------------------------------------------------------------ Confetti */
  function confetti(canvas) {
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => { canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; };
    resize();
    window.addEventListener("resize", resize);
    const colors = ["#e36b24", "#ff8b45", "#fbfaf4", "#ffd2b4", "#3ecf8e"];
    const parts = Array.from({ length: 160 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 120,
      y: innerHeight * 0.42,
      vx: (Math.random() - 0.5) * 16,
      vy: -Math.random() * 15 - 5,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 10,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      c: colors[(Math.random() * colors.length) | 0],
    }));
    const t0 = performance.now();
    const frame = (now) => {
      const life = now - t0;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, life - 2600) / 1200);
      parts.forEach((p) => {
        p.vy += 0.38; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save();
        ctx.translate(p.x * dpr, p.y * dpr);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect((-p.w / 2) * dpr, (-p.h / 2) * dpr, p.w * dpr, p.h * Math.abs(Math.cos(p.r * 2)) * dpr);
        ctx.restore();
      });
      if (life < 3800) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    requestAnimationFrame(frame);
  }
})();
