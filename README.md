# Throttle landing page

A single-page site where riders learn what Throttle is and pre-register for
Pro with a one-time $9.99 payment through **Paddle** (Pro is $49.99/year
after launch). Plain HTML, CSS and JS, with no build step. It uses the
**same Supabase project** as the Flutter app (`../wheelsclub`).

```
throttle_landing/
├── index.html                  the page (v3)
├── vercel.json                 security headers (CSP, HSTS, no framing)
├── .vercelignore               allowlist: only index.html, assets/, vercel.json deploy
├── assets/
│   ├── css/styles.css          the only stylesheet
│   ├── js/config.js            public settings (Supabase, Paddle client token, prices)
│   ├── js/main.js              animations, enroll form, Paddle checkout, success screen
│   ├── js/theme.js             applies the saved light/dark theme before paint
│   ├── js/analytics.js         Google Analytics setup
│   └── img/                    logo, ride cards, icons, social preview image
├── unused/                     old pages, concepts and images (not deployed)
└── supabase/
    ├── config.toml             function settings (JWT check off for all)
    └── functions/
        ├── paddle-checkout/    saves a pending row, creates a Paddle transaction
        ├── paddle-webhook/     marks rows paid / refunded
        ├── create-checkout/    Stripe version, parked (not used by the page)
        ├── stripe-webhook/     Stripe version, parked (not used by the page)
        └── _shared/            cors.ts, paddle.ts (API calls + signature check)
```

The database lives with the app's other migrations:
`../wheelsclub/supabase/migrations/20261024000000_pre_enrollments.sql` and
`20261027000000_reserved_usernames.sql` (usernames riders reserve when they
pre-register; nobody else can take them on the site or in the app).

The table's columns are still named `stripe_*`. With Paddle they hold Paddle
ids: `stripe_checkout_session_id` and `stripe_payment_intent_id` hold the
transaction id (`txn_…`), `stripe_customer_id` holds the customer id (`ctm_…`).

## How a pre-enrollment works

1. The rider enters their email and @username and presses **Pre-register for $9.99**.
2. `paddle-checkout` checks the username is free and the email hasn't already
   paid, inserts a `pending` row in `public.pre_enrollments`, and creates a
   Paddle transaction for $9.99.
3. The page opens that transaction in Paddle's checkout, as a pop-up on the
   same page. When the payment goes through, the page shows a "You're in" screen.
4. Paddle calls `paddle-webhook`, which marks the row `paid` and reserves the
   username (or `refunded` later, after a full refund or a chargeback).
5. When the rider signs in to the app with the same email, the row's `user_id`
   is filled in automatically. The app can check `is_founding_rider()`.

Paddle is the merchant of record: it charges the customer, handles sales tax
and VAT, sends the receipt, and the charge shows as `PADDLE.NET*` on bank
statements.

## Run locally

```bash
python3 -m http.server 5180 --directory .
```

Then open http://localhost:5180. The page works without the backend; the
form just shows an error until the functions are deployed and
`paddleClientToken` is set.

## Set up (once)

### 1. Database

Run the migration in the Supabase SQL editor (or `npx supabase db push` from
`../wheelsclub`):

```
../wheelsclub/supabase/migrations/20261024000000_pre_enrollments.sql
```

### 2. Paddle

Paddle has two separate accounts: **sandbox** (fake money, at
sandbox-vendors.paddle.com) and **live** (real money, at vendors.paddle.com).
Set up sandbox first, then repeat these steps in live. Keys, products and
webhooks don't carry over between them.

1. **Default payment link.** Paddle > **Checkout > Checkout settings** > set
   **Default payment link** to your site, e.g. `https://yourdomain.com/`.
   Paddle refuses to create transactions until this is set.
2. **Live only: domain approval.** Paddle > **Checkout > Website approval** >
   add your domain. Paddle reviews it before live checkout works. They check
   that the site shows pricing, a refund policy, terms and a privacy policy,
   and a way to contact you.
3. **API key (secret, server only).** Paddle > **Developer tools >
   Authentication** > **API keys** > create one with permission to read and
   write **Transactions**. Sandbox keys look like `pdl_sdbx_apikey_…`, live
   ones `pdl_live_apikey_…`.
4. **Client-side token (public, for the page).** Same page > **Client-side
   tokens** > create one. Sandbox tokens start with `test_`, live with `live_`.
   Put it in `assets/js/config.js` as `paddleClientToken`.
5. **Optional: a catalog price.** Paddle > **Catalog > Products** > new
   product "Throttle Pro: Pre-registration" with a one-time $9.99 price. Copy
   its id (`pri_…`). Without it, `paddle-checkout` charges $9.99 with an
   inline price.

About tax: depending on your Paddle tax settings, sales tax or VAT may be
added on top of $9.99 for some buyers. To make $9.99 the final price
everywhere, set your prices to tax-inclusive in Paddle.

### 3. Deploy the functions

From this folder (put your own keys in; don't commit them):

```bash
npx supabase login
npx supabase secrets set PADDLE_API_KEY=pdl_sdbx_apikey_... --project-ref lioglcwbfrjdyrcgwfut
npx supabase functions deploy paddle-checkout --no-verify-jwt --project-ref lioglcwbfrjdyrcgwfut
npx supabase functions deploy paddle-webhook --no-verify-jwt --project-ref lioglcwbfrjdyrcgwfut
```

Optional secrets: `PADDLE_PRICE_ID=pri_…`, `PADDLE_ENV=sandbox|live` (only if
your API key doesn't say which; the function reads `_sdbx_` in the key), and
`ALLOWED_ORIGINS=https://your-domain.com,http://localhost:5180` to accept form
calls only from your site.

### 4. Paddle webhook

The webhook is how the database learns a payment went through. It's the
moment a pre-registration becomes "paid" and the rider's @username becomes
theirs. Without it nothing is ever marked paid.

**a. Create the destination.** Paddle > **Developer tools > Notifications** >
**New destination**:

- Type: **Webhook**
- URL: `https://lioglcwbfrjdyrcgwfut.supabase.co/functions/v1/paddle-webhook`
- Events (tick each one):
  - `transaction.paid`
  - `transaction.completed`
  - `adjustment.created`
  - `adjustment.updated`
- Description (optional): "Throttle pre-registration". Save.

**b. Copy the secret key.** Open the destination > copy its **secret key**
(starts with `pdl_ntfset_…`).

**c. Give it to the function:**

```bash
npx supabase secrets set PADDLE_WEBHOOK_SECRET=pdl_ntfset_... --project-ref lioglcwbfrjdyrcgwfut
```

No redeploy needed; the function reads the secret on its next request.

The webhook also only accepts deliveries from Paddle's own IP addresses. It
reads the current list from `https://api.paddle.com/ips` (or
`sandbox-api.paddle.com/ips` with a sandbox key) and refreshes it hourly, so
there's nothing to keep up to date. A rejected delivery returns 403 and logs
the caller's address. In an emergency, `PADDLE_IP_ALLOWLIST=off` turns the
check off; the signature check still runs.

**d. Test it (sandbox).** On the site, pre-register with a real email you
control and a new username, and pay with Paddle's test card
`4242 4242 4242 4242`, any future expiry, CVC `100`. Then check:

- Paddle > **Developer tools > Notifications** > your destination > **Logs**:
  `transaction.completed` shows **200**. (400 means the secret key doesn't
  match; 500 means the database step failed, see Supabase > **Edge Functions
  > paddle-webhook > Logs**.)
- Supabase > **Table Editor > pre_enrollments**: your row has
  `status = paid` and your `username`.
- The site's username check now says that name is reserved.

**e. Going live.** In the live Paddle account repeat steps 2 and 4 (live has
its own API key, client token, price and webhook secret), then:

1. Put the live `paddleClientToken` (`live_…`) in `config.js` and push.
2. `npx supabase secrets set PADDLE_API_KEY=pdl_live_apikey_... PADDLE_WEBHOOK_SECRET=pdl_ntfset_... --project-ref lioglcwbfrjdyrcgwfut`
   (and `PADDLE_PRICE_ID` if you use one; drop `PADDLE_ENV` or set it to `live`).
3. Delete your sandbox test rows from `pre_enrollments` first. A paid
   sandbox row still holds its username.

Sandbox and live keys can't be mixed: a sandbox token with a live API key
(or the other way round) makes checkout fail.

### 5. Host the page

Only `index.html`, `assets/` and `vercel.json` go to the web host (on cPanel,
also `unused/.htaccess` copied to the site root). `supabase/` is backend code
for Supabase, not for the host.

The page has no inline `<script>` blocks on purpose: `vercel.json` sends a
Content-Security-Policy that only allows scripts from this site and Google
Tag Manager. If you add a new third-party script, font or API, add its domain
to that policy or the browser will block it.

#### Option A: Vercel

**From the terminal** (fastest):

```bash
cd throttle_landing
npx vercel          # first time: log in, "Set up and deploy?" Y, pick your account,
                    # "Link to existing project?" N, name it, directory "./",
                    # it detects no framework: keep the defaults (no build command)
npx vercel --prod   # publish to your production URL
```

`.vercelignore` is an allowlist, so `supabase/`, `unused/` and this README
never get uploaded.

**From GitHub** (auto-deploys on every push): push this folder to a GitHub
repo, then on vercel.com → **Add New → Project** → import the repo →
Framework Preset **Other**, Build Command empty, Output Directory `./` →
**Deploy**.

**Your domain:** Project → **Settings → Domains** → add `yourdomain.com` and
follow the DNS records Vercel shows.

#### Option B: cPanel File Manager

1. Make a zip of the site files (from inside this folder):
   ```bash
   cd throttle_landing
   cp unused/.htaccess .htaccess
   zip -r throttle_site.zip index.html assets .htaccess
   ```
2. cPanel → **SSL/TLS Status** → run **AutoSSL** for the domain, so it has
   HTTPS (`.htaccess` redirects every visit to HTTPS).
3. cPanel → **File Manager** → open `public_html` (or the subdomain's folder,
   e.g. `public_html/throttle`). If an old `index.html` / `index.php` is there,
   delete or rename it.
4. **Upload** → choose `throttle_site.zip` → back in File Manager, right-click
   the zip → **Extract** → into the current folder. Then delete the zip.
5. Check `index.html` sits directly in `public_html` (not in a sub-folder) and
   open your domain. `.htaccess` is hidden by default: **Settings → Show Hidden
   Files** to see it.

To update later, upload the changed files over the old ones (or a new zip and
extract, overwriting). When you change `styles.css` / `main.js`, bump their
`?v=` number in `index.html` so browsers fetch the new copy.

#### After either option

Only accept form calls from your site:

```bash
npx supabase secrets set ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com --project-ref lioglcwbfrjdyrcgwfut
```

Then set Paddle's **Default payment link** to the live address, and for live
payments add the domain under **Checkout > Website approval**.

## Settings (`assets/js/config.js`)

| Key | What it does |
|-----|--------------|
| `supabaseUrl`, `supabasePublishableKey` | Same values as the app's `lib/config/env.dart` |
| `offerPrice` | Price shown on the page (charged amount is set in Paddle / `paddle-checkout`) |
| `launchPrice` | Shown struck through next to the offer price; hidden while empty |
| `launchPriceText` | The after-launch price in sentences (perks, FAQ) |
| `showCountFrom` | The hero shows "N founding riders already in" once N reaches this |
| `contactEmail` | Adds a Contact link to the footer |
| `paddleClientToken` | Paddle client-side token: `test_…` for sandbox, `live_…` for real payments |

## Visit and form tracking

`main.js` records each visitor's steps (page view, saw the form, started it,
which fields they filled, pressed Pre-register, opened checkout, cancelled or
paid) in `public.site_events` through `track_event()`. It sends steps and
field names only, never what was typed. The admin panel in `../adminPanel`
(runs on your computer, not part of this site) shows them.

The same steps go to Google Analytics as events: `enroll_form_view`,
`enroll_form_start`, `enroll_field_filled` (with `field`), `enroll_submit`,
`enroll_error` (with `reason`), `begin_checkout`, `checkout_cancelled` and
`purchase`. Mark `enroll_submit` and `purchase` as key events in GA (Admin →
Events) to see form fills and payments in its reports.

To stop your own visits counting, open the site once on each of your devices
with `?notrack=1` (e.g. `https://yourdomain.com/?notrack=1`); `?notrack=0`
undoes it.

Needs the migration
`../wheelsclub/supabase/migrations/20261028000000_site_events.sql`. Until it
runs, the page still works; the events just aren't saved.
