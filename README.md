# Throttle landing page

A single-page site where riders learn what Throttle is and pre-register for
Pro with a one-time $1.99 Stripe payment (Pro is $15.99/year after
launch). Plain HTML, CSS and JS, with no
build step. It uses the **same Supabase project** as the Flutter app
(`../wheelsclub`).

```
throttle_landing/
├── index.html                  the page
├── .htaccess                   cPanel/Apache: HTTPS, compression, caching
├── .vercelignore               keeps backend code out of Vercel uploads
├── assets/
│   ├── css/styles.css
│   ├── js/config.js            public settings (Supabase URL + publishable key, prices)
│   ├── js/main.js              animations, enroll form, post-checkout screen
│   └── img/                    logo, ride cards, icons, social preview image
└── supabase/
    ├── config.toml             function settings (JWT check off for both)
    └── functions/
        ├── create-checkout/    saves a pending row, returns a Stripe Checkout URL
        ├── stripe-webhook/     marks rows paid / expired / failed / refunded
        └── _shared/cors.ts
```

The database lives with the app's other migrations:
`../wheelsclub/supabase/migrations/20261024000000_pre_enrollments.sql` and
`20261027000000_reserved_usernames.sql` (usernames riders reserve when they
pre-register; nobody else can take them on the site or in the app).

## How a pre-enrollment works

1. The rider enters their email (and, optionally, their bike) and presses **Pre-register for $1.99**.
2. `create-checkout` checks the email hasn't already paid, inserts a `pending`
   row in `public.pre_enrollments`, and opens a Stripe Checkout for $1.99.
3. After paying, Stripe sends the rider back to `/?enrolled=<session id>`,
   where the page shows a "You're in" screen.
4. Stripe calls `stripe-webhook`, which marks the row `paid` (or `expired`,
   `failed`, `refunded` later).
5. When the rider signs in to the app with the same email, the row's `user_id`
   is filled in automatically. The app can check `is_founding_rider()`.

## Run locally

```bash
python3 -m http.server 5180 --directory .
```

Then open http://localhost:5180. The page works without the backend; the
form just shows an error until the functions are deployed.

## Set up (once)

### 1. Database

Run the migration in the Supabase SQL editor (or `npx supabase db push` from
`../wheelsclub`):

```
../wheelsclub/supabase/migrations/20261024000000_pre_enrollments.sql
```

### 2. Stripe

1. In the [Stripe dashboard](https://dashboard.stripe.com), copy your secret key
   (start with test mode: `sk_test_…`).
2. Optional: create a product "Throttle Pro: Pre-registration" with a one-time $1.99 price
   and copy its price id (`price_…`). Without it, the function charges $1.99 with
   an inline price.

### 3. Deploy the functions

From this folder:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase secrets set STRIPE_SECRET_KEY=sk_test_... SITE_URL=https://your-domain.com
npx supabase functions deploy create-checkout --no-verify-jwt
npx supabase functions deploy stripe-webhook --no-verify-jwt
```

Optional secrets: `STRIPE_PRICE_ID=price_…`, and
`ALLOWED_ORIGINS=https://your-domain.com,http://localhost:5180` to accept form
calls only from your site.

### 4. Stripe webhook

The webhook is how the database learns a payment went through. It's the
moment a pre-registration becomes "paid" and the rider's @username becomes
theirs. Without it nothing is ever marked paid.

**a. Pick the mode.** The webhook must be in the same Stripe mode as
`STRIPE_SECRET_KEY`: test (`sk_test_…`) or live (`sk_live_…`). Use the
**Test mode** toggle at the top of the Stripe dashboard; set up test first.

**b. Create the endpoint.** Stripe dashboard → **Developers → Webhooks**
(in newer dashboards: **Workbench → Webhooks**) → **Add endpoint** (or
**Add destination**):

- If asked where events come from, choose **Your account**.
- Events to send (search each one and tick it):
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.async_payment_failed`
  - `checkout.session.expired`
  - `charge.refunded`
- If asked for a destination type, choose **Webhook endpoint**.
- Endpoint URL: `https://<your-project-ref>.supabase.co/functions/v1/stripe-webhook`
- Description (optional): "Throttle pre-registration". Save.

**c. Copy the signing secret.** Open the endpoint you just made → **Signing
secret** → **Reveal** → copy the value starting with `whsec_`.

**d. Give it to the function** (from this folder):

```bash
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_... --project-ref <your-project-ref>
```

No redeploy needed; the function reads the secret on its next request.

**e. Test it.** On the site, pre-register with a real email you control and a
new username, and pay with card `4242 4242 4242 4242`, any future expiry,
any CVC, any postcode. Then check:

- Stripe → your webhook endpoint → **Event deliveries**: `checkout.session.completed`
  shows **200**. (400 means the signing secret doesn't match; 500 means the
  database step failed, see the function's logs in Supabase →
  **Edge Functions → stripe-webhook → Logs**.)
- Supabase → **Table Editor → pre_enrollments**: your row has
  `status = paid` and your `username`.
- The site's username check now says that name is reserved.

**f. Going live.** Switch Stripe to live mode and repeat b–d there (live mode
has its own endpoint and its own `whsec_` secret), and set the live
`STRIPE_SECRET_KEY` (`sk_live_…`). Test-mode and live-mode secrets can't be mixed.

### 5. Host the page

Only `index.html`, `assets/` (and `.htaccess` on cPanel) go to the web host.
`supabase/` is backend code for Supabase, not for the host.

#### Option A: Vercel

**From the terminal** (fastest):

```bash
cd throttle_landing
npx vercel          # first time: log in, "Set up and deploy?" Y, pick your account,
                    # "Link to existing project?" N, name it, directory "./",
                    # it detects no framework: keep the defaults (no build command)
npx vercel --prod   # publish to your production URL
```

`.vercelignore` keeps `supabase/` and this README out of the upload.

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

Point Stripe back at the live address:

```bash
npx supabase secrets set SITE_URL=https://yourdomain.com \
  ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

To take real payments, swap the test keys for live ones (`sk_live_…`, a live
webhook endpoint and its `whsec_…`).

## Settings (`assets/js/config.js`)

| Key | What it does |
|-----|--------------|
| `supabaseUrl`, `supabasePublishableKey` | Same values as the app's `lib/config/env.dart` |
| `offerPrice` | Price shown on the page (charged amount is set in Stripe / the function) |
| `launchPrice` | Shown struck through next to the offer price; hidden while empty |
| `launchPriceText` | The after-launch price in sentences (perks, FAQ) |
| `showCountFrom` | The hero shows "N founding riders already in" once N reaches this |
| `contactEmail` | Adds a Contact link to the footer |

## Admin panel (later)

The database is ready for it:

- `public.admins` lists who can use the panel (`role`: `admin` or `viewer`).
  Add someone from the SQL editor:
  ```sql
  insert into public.admins (user_id)
  select id from auth.users where email = 'you@example.com';
  ```
- `public.is_admin()` / `is_admin('admin')` are what row-level security checks.
  Admins can read every pre-enrollment; `admin` role can also edit rows
  (e.g. `admin_note`).
- `pre_enrollments.source` records `utm_*`, `ref` and the referrer, so the panel
  can show which posts and campaigns bring riders.

So the panel can sign in with Supabase Auth (Google, like the app) and use the
same publishable key. It never needs the service-role key in the browser. A
natural place for it is `throttle_landing/admin/` (served at `/admin`) or its
own folder next to this one.
