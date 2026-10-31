/* indexv2 hero: a live ride. A rider dot rides the route on a loop, drawing
   the line behind it, with a tag beside it showing distance and speed.

   The ride is the one on the hero card: 24.3 km in 13 min (avg 112 km/h),
   top speed 194 km/h. The dot's movement comes from that speed, so it surges
   when the tag hits 194, and the "Top speed" gauge and "Recording" clock on
   the cards play the same ride.

   Desktop (.hr-desk): the route is drawn around the real headline and cards,
   measured on load and on resize. Phones (.hr-mob): a fixed route in its own
   viewBox that wraps around the cards. Whichever is showing animates. */
(() => {
  "use strict";

  const hero = document.querySelector(".hero--route");
  if (!hero) return;

  /* ---------- The ride ---------- */
  const TOTAL_KM = 24.3;
  const RIDE_MIN = 13;
  const AVG_KMH = 112;
  const TOP_KMH = 194;
  const LAP_MS = 8000;     // one lap along the route
  const HOLD_MS = 1800;    // pause at the finish before the next lap
  const GAUGE_MAX = 220;   // the gauge's scale (same as main.js)
  const BURST_AT = 0.72;   // when (0-1 through the lap) the rider goes full throttle

  // Speed over the lap: pull away, cruise with small changes, one burst to the
  // top speed, ease into the finish. Scaled to average AVG_KMH and peak at
  // TOP_KMH, so distance and time add up to the card. Precomputed as tables.
  const N = 800;
  const smoothstep = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const ramp = (t) => smoothstep(t / 0.08) * smoothstep((1 - t) / 0.07);
  const cruise = (t) => ramp(t) * (1 + 0.14 * Math.sin(2 * Math.PI * (2.2 * t + 0.1)));
  const burst = (t) => ramp(t) * Math.exp(-Math.pow((t - BURST_AT) / 0.085, 2));
  const cs = [], bs = [];
  for (let i = 0; i <= N; i++) { cs.push(cruise(i / N)); bs.push(burst(i / N)); }
  const mean = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
  // Solve a*cruise + b*burst for: mean = AVG_KMH, value at the burst = TOP_KMH.
  const mc = mean(cs), mb = mean(bs), cp = cruise(BURST_AT), bp = burst(BURST_AT);
  const b = (TOP_KMH - (cp * AVG_KMH) / mc) / (bp - (cp * mb) / mc);
  const a = (AVG_KMH - b * mb) / mc;
  const speed = cs.map((c, i) => Math.min(TOP_KMH, Math.max(0, a * c + b * bs[i])));
  const dist = [0];            // cumulative distance, then normalised to 0-1
  const topSoFar = [speed[0]];
  for (let i = 1; i <= N; i++) {
    dist.push(dist[i - 1] + (speed[i - 1] + speed[i]) / 2);
    topSoFar.push(Math.max(topSoFar[i - 1], speed[i]));
  }
  const total = dist[N];
  const rideAt = (t) => {
    const x = Math.max(0, Math.min(1, t)) * N;
    const i = Math.min(N - 1, Math.floor(x)), f = x - i;
    const lerp = (arr) => arr[i] + (arr[i + 1] - arr[i]) * f;
    return { s: lerp(dist) / total, kmh: lerp(speed), top: lerp(topSoFar) };
  };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const phone = window.matchMedia("(max-width: 1020px)");

  /* ---------- Cards' stats: "Top speed" gauge and "Recording" clock ---------- */
  // main.js (shared with index.html) runs its own one-off count-up and clock
  // on these. Swap in fresh copies so only this ride drives them here.
  const takeOver = (sel) => {
    const el = hero.querySelector(sel);
    if (!el) return null;
    const copy = el.cloneNode(true);
    el.replaceWith(copy);
    return copy;
  };
  const gaugeNum = takeOver("[data-speed]");
  const gaugeFill = takeOver(".gauge__fill");
  const clock = takeOver("[data-clock]");
  const pad = (n) => String(Math.floor(n)).padStart(2, "0");
  function showStats(t, r) {
    if (gaugeNum) gaugeNum.textContent = String(Math.round(r.top));
    if (gaugeFill) gaugeFill.style.strokeDashoffset = String(100 - (r.top / GAUGE_MAX) * 100);
    if (clock) {
      const secs = RIDE_MIN * 60 * t;
      clock.textContent = `00:${pad(secs / 60)}:${pad(secs % 60)}`;
    }
  }

  /* ---------- Views ---------- */
  // The tag lives in its own layer above the cards, so it's never hidden
  // behind them; it still steers clear of them where there's room.
  function tagLayer(view, parent, className) {
    const layer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    layer.setAttribute("class", className);
    layer.setAttribute("aria-hidden", "true");
    const vb = view.svg.getAttribute("viewBox");
    if (vb) layer.setAttribute("viewBox", vb);
    layer.appendChild(view.tag);
    parent.appendChild(layer);
    view.layer = layer;
  }

  const makeView = (svg) => svg && {
    svg,
    measure: svg.querySelector(".hr-measure"),
    line: svg.querySelector(".hr-line"),
    start: svg.querySelector(".hr-start"),
    flag: svg.querySelector(".hr-flag"),
    rider: svg.querySelector(".hr-rider"),
    tag: svg.querySelector(".hr-tag"),
    pill: svg.querySelector(".hr-tag rect"),
    text: svg.querySelector(".hr-tag text"),
    km: svg.querySelector(".hr-tag-km"),
    spd: svg.querySelector(".hr-tag-spd"),
    len: 0,
    spot: -1,            // which side of the dot the tag is on (kept steady)
    obstacles: null,
  };
  const desk = makeView(hero.querySelector(".hr-desk"));
  const mob = makeView(hero.querySelector(".hr-mob"));
  if (desk) tagLayer(desk, hero, "hr-tags hr-tags--desk");
  if (mob) tagLayer(mob, mob.svg.parentNode, "hr-mob hr-tags hr-tags--mob");
  const current = () => (phone.matches ? mob : desk);

  /* ---------- Desktop: lay the route out around the content ---------- */
  const NAV_GAP = 40;     // keep the route this far below the nav
  const BOTTOM_GAP = 56;  // ...and this far above the bottom of the hero

  function layoutDesk() {
    if (!desk || phone.matches) return;
    const box = hero.querySelector(".hero__bg").getBoundingClientRect();
    if (!box.width) return;
    const rel = (r) => ({ l: r.left - box.left, t: r.top - box.top, r: r.right - box.left, b: r.bottom - box.top });
    const union = (els) => els.map((el) => el.getBoundingClientRect()).reduce((u, r) => ({
      left: Math.min(u.left, r.left), top: Math.min(u.top, r.top), right: Math.max(u.right, r.right), bottom: Math.max(u.bottom, r.bottom),
    }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });

    const nav = document.querySelector(".nav");
    const navBottom = nav ? nav.getBoundingClientRect().bottom - box.top : 68;
    const copy = rel(hero.querySelector(".hero__copy").getBoundingClientRect());
    const meta = rel((hero.querySelector(".hero__meta") || hero.querySelector(".hero__ctas")).getBoundingClientRect());
    const cards = rel(union([...hero.querySelectorAll(".fan__card, .fan .float")]));
    const W = box.width, H = box.height;
    const cw = cards.r - cards.l, ch = cards.b - cards.t;

    const top = navBottom + NAV_GAP;
    const bottom = H - BOTTOM_GAP;
    const FLAG_H = 46;                       // the finish flag stands this tall above its point
    const right = W - 64;                    // the curve bulges a little past its points
    const clampX = (x) => Math.min(right, Math.max(28, x));
    const clampY = (y) => Math.min(bottom, Math.max(top, y));

    // Bottom lane: under the text and the cards.
    const lane = clampY(Math.max(meta.b + 52, cards.b + 70));
    const pts = [
      [copy.l + 6, lane - 8],                                  // start, under the text
      [copy.l + (copy.r - copy.l) * 0.45, lane + 12],
      [cards.l - 30, lane - 6],
      [cards.l + cw * 0.55, lane + 10],
      [cards.r + 46, cards.t + ch * 0.66],                     // up the right of the cards
      [cards.r + 34, cards.t + ch * 0.2],
      [cards.l + cw * 0.62, cards.t - 46],                     // over the top
      [cards.l + cw * 0.16, Math.max(cards.t - 26, top + FLAG_H)], // finish, flag clear of the nav
    ].map(([x, y]) => [clampX(x), clampY(y)]);

    const d = smoothPath(pts);
    desk.measure.setAttribute("d", d);
    desk.line.setAttribute("d", d);
    desk.start.setAttribute("cx", pts[0][0].toFixed(1));
    desk.start.setAttribute("cy", pts[0][1].toFixed(1));
    const end = pts[pts.length - 1];
    desk.flag.setAttribute("transform", `translate(${end[0].toFixed(1)} ${end[1].toFixed(1)})`);
    desk.len = 0;
  }

  // Smooth line through points (Catmull-Rom as cubic Béziers).
  function smoothPath(pts) {
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, pts.length - 1)];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
  }

  /* ---------- Where the tag goes ---------- */
  // Things the tag should stay off, in the view's own units. Text and the nav
  // matter most; cards less (the tag floats above them when it must).
  function measureObstacles(v) {
    const m = v.svg.getScreenCTM();
    if (!m) return;
    const inv = m.inverse();
    const toView = (r) => {
      const p1 = new DOMPoint(r.left, r.top).matrixTransform(inv);
      const p2 = new DOMPoint(r.right, r.bottom).matrixTransform(inv);
      return { l: Math.min(p1.x, p2.x), t: Math.min(p1.y, p2.y), r: Math.max(p1.x, p2.x), b: Math.max(p1.y, p2.y) };
    };
    const rectsOf = (sel, weight) => [...document.querySelectorAll(sel)]
      .map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height)
      .map((r) => ({ ...toView(r), weight }));
    const h = hero.getBoundingClientRect();
    v.bounds = toView({ left: Math.max(h.left, 0) + 8, top: h.top + 8, right: Math.min(h.right, window.innerWidth) - 8, bottom: h.bottom - 8 });
    v.obstacles = [
      ...rectsOf(".nav", 12),
      ...rectsOf(".hero__copy h1, .hero__copy h2, .hero__price, .hero__ctas, .hero__meta", 12),
      ...rectsOf(".fan .float", 3),
      ...rectsOf(".fan__card", 1),
    ];
  }

  const H_TAG = 44;
  // Candidate spots around the dot, in order of preference.
  const spots = (w) => [
    [22, -66], [-w - 22, -66],   // above right / above left
    [26, -22], [-w - 26, -22],   // right / left
    [22, 22], [-w - 22, 22],     // below right / below left
    [-w / 2, -70], [-w / 2, 26], // centred above / below
  ];
  const overlap = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
  function costAt(v, x, y, w) {
    const box = { l: x, t: y, r: x + w, b: y + H_TAG };
    let cost = 0;
    for (const o of v.obstacles) cost += o.weight * overlap(box, o);
    const B = v.bounds;
    const out = Math.max(0, B.l - box.l) + Math.max(0, box.r - B.r) + Math.max(0, B.t - box.t) + Math.max(0, box.b - B.b);
    return cost + out * H_TAG * 20;
  }
  function placeTag(v, pt, w) {
    if (!v.obstacles) measureObstacles(v);
    if (!v.obstacles) return;
    const list = spots(w);
    const costs = list.map(([dx, dy]) => costAt(v, pt.x + dx, pt.y + dy, w));
    let best = costs.indexOf(Math.min(...costs));
    // Stay put unless the current spot is clearly worse (stops the tag flickering between sides).
    if (v.spot >= 0 && costs[v.spot] <= costs[best] + 400) best = v.spot;
    v.spot = best;
    const [dx, dy] = list[best];
    v.tag.setAttribute("transform", `translate(${(pt.x + dx).toFixed(1)} ${(pt.y + dy).toFixed(1)})`);
  }

  /* ---------- Drawing ---------- */
  function draw(v, t, finished) {
    if (!v) return;
    if (!v.len) v.len = v.measure.getTotalLength();
    if (!v.len) return; // not laid out yet
    const r = rideAt(t);
    const pt = v.measure.getPointAtLength(v.len * r.s);
    v.rider.setAttribute("transform", `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
    v.line.style.strokeDashoffset = String(1000 * (1 - r.s));
    v.km.textContent = `${(TOTAL_KM * r.s).toFixed(1)} km`;
    v.spd.textContent = finished ? `top ${TOP_KMH} km/h` : `${Math.round(r.kmh)} km/h`;
    // Pill fits its text: 30px for the live dot, two 8px gaps around "·", 14px right padding.
    const w = Math.ceil(v.text.getComputedTextLength()) + 30 + 16 + 14;
    v.pill.setAttribute("width", String(w));
    placeTag(v, pt, w);
    v.rider.classList.add("is-on");
    v.layer.classList.add("is-live");
    showStats(t, r);
  }

  let progress = { t: 0, finished: false };
  const redraw = () => draw(current(), progress.t, progress.finished);

  // Re-measure when the layout changes (resize, fonts loading, phone <-> desktop).
  const relayout = () => {
    layoutDesk();
    [desk, mob].forEach((v) => { if (v) { v.obstacles = null; v.spot = -1; if (v === mob) v.len = 0; } });
    redraw();
  };
  relayout();
  if (document.fonts) document.fonts.ready.then(relayout);
  window.addEventListener("load", relayout);
  phone.addEventListener("change", relayout);
  if ("ResizeObserver" in window) new ResizeObserver(relayout).observe(hero);
  else window.addEventListener("resize", relayout);
  // The nav is fixed, so what the tag must avoid shifts as the page scrolls.
  window.addEventListener("scroll", () => [desk, mob].forEach((v) => v && (v.obstacles = null)), { passive: true });

  if (reduceMotion) {
    // Still picture: the finished ride.
    progress = { t: 1, finished: true };
    redraw();
    return;
  }

  let raf = 0;
  let t0 = 0;
  let frames = 0;
  function frame(now) {
    if (!t0) t0 = now;
    const ms = (now - t0) % (LAP_MS + HOLD_MS);
    progress = { t: Math.min(1, ms / LAP_MS), finished: ms >= LAP_MS };
    // Cards ease in on load and lift on hover: re-measure them now and then.
    if (++frames % 30 === 0) { const v = current(); if (v) v.obstacles = null; }
    redraw();
    raf = requestAnimationFrame(frame);
  }

  // Only animate while the hero is on screen.
  const start = () => { if (!raf) raf = requestAnimationFrame(frame); };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => (entry.isIntersecting ? start() : stop())).observe(hero);
  } else {
    start();
  }
})();
