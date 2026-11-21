// Contact page: builds a pre-filled email (subject from the chosen topic) and
// opens it in the visitor's mail app. No backend. ?topic=<value> preselects a
// topic, so links like /contact?topic=delete-account can be shared directly.
(function () {
  var cfg = window.THROTTLE_CONFIG || {};
  var to = cfg.contactEmail || "blackstellarholdings@gmail.com";

  var SUBJECTS = {
    help: "Help",
    support: "Support",
    "delete-account": "Delete account",
    billing: "Billing & refunds",
    bug: "Bug report",
    feedback: "Feedback",
    privacy: "Privacy request",
    other: "General enquiry",
  };

  var form = document.getElementById("contactForm");
  var msg = document.getElementById("contactMsg");
  var note = document.getElementById("deleteNote");
  var preview = document.getElementById("subjectPreview");
  var addr = document.getElementById("contactAddr");
  var copyBtn = document.getElementById("copyBtn");
  var message = form.elements.message;

  addr.href = "mailto:" + to;
  addr.textContent = to;

  function topic() {
    var el = form.querySelector('input[name="topic"]:checked');
    return el ? el.value : "help";
  }

  function subject() {
    var s = "[Throttle] " + (SUBJECTS[topic()] || SUBJECTS.help);
    var u = form.elements.username.value.trim().replace(/^@/, "");
    return u ? s + " (@" + u + ")" : s;
  }

  function body() {
    var f = form.elements;
    var lines = [f.message.value.trim(), "", "—"];
    if (f.name.value.trim()) lines.push("Name: " + f.name.value.trim());
    if (f.email.value.trim()) lines.push("Account email: " + f.email.value.trim());
    if (f.username.value.trim()) lines.push("Username: @" + f.username.value.trim().replace(/^@/, ""));
    lines.push("Topic: " + (SUBJECTS[topic()] || SUBJECTS.help));
    return lines.join("\n");
  }

  var PLACEHOLDERS = {
    "delete-account": "Please delete my Throttle account and all of its data.",
    bug: "What happened, what you expected, and your phone model / app version…",
    billing: "Your order number (from the Paddle receipt) helps us find it fast…",
    privacy: "Tell us what you'd like: a copy of your data, a correction, or something else…",
  };

  function sync(fromUser) {
    var t = topic();
    var del = t === "delete-account";
    note.hidden = !del;
    message.placeholder = PLACEHOLDERS[t] || "Tell us what's going on…";
    if (del && !message.value.trim()) message.value = PLACEHOLDERS["delete-account"];
    if (!del && message.value === PLACEHOLDERS["delete-account"]) message.value = "";
    preview.textContent = subject();
    if (fromUser && window.history && history.replaceState) {
      history.replaceState(null, "", t === "help" ? location.pathname : location.pathname + "?topic=" + t);
    }
  }

  var wanted = new URLSearchParams(location.search).get("topic");
  if (wanted && SUBJECTS[wanted]) {
    var el = form.querySelector('input[name="topic"][value="' + wanted + '"]');
    if (el) el.checked = true;
  }
  sync(false);

  form.addEventListener("change", function (e) { if (e.target.name === "topic") sync(true); });
  form.elements.username.addEventListener("input", function () { preview.textContent = subject(); });

  function setMsg(text, ok) {
    msg.textContent = text;
    msg.classList.toggle("is-ok", !!ok);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = form.elements.email;
    var bad = null;
    email.removeAttribute("aria-invalid");
    message.removeAttribute("aria-invalid");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { email.setAttribute("aria-invalid", "true"); bad = bad || email; }
    if (!message.value.trim()) { message.setAttribute("aria-invalid", "true"); bad = bad || message; }
    if (bad) { setMsg("Add your email and a message so we can reply."); bad.focus(); return; }

    window.location.href = "mailto:" + to + "?subject=" + encodeURIComponent(subject()) + "&body=" + encodeURIComponent(body());
    setMsg("Your email app should open with everything filled in. Just hit send. Nothing opened? Copy the message below and email us.", true);
    if (typeof window.gtag === "function") window.gtag("event", "contact_open_mail", { topic: topic() });
  });

  copyBtn.addEventListener("click", function () {
    var text = "To: " + to + "\nSubject: " + subject() + "\n\n" + body();
    var done = function () { copyBtn.textContent = "Copied"; setTimeout(function () { copyBtn.textContent = "Copy message"; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { window.prompt("Copy this:", text); });
    } else {
      window.prompt("Copy this:", text);
    }
  });
})();
