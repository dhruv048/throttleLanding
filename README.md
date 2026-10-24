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

The database table lives with the app's other migrations:
`../wheelsclub/supabase/migrations/20261024000000_pre_enrollments.sql`.

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

Stripe dashboard → **Developers → Webhooks → Add endpoint**:

- URL: `https://<your-project-ref>.supabase.co/functions/v1/stripe-webhook`
- Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`

Copy the signing secret and set it:

```bash
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```

Test with card `4242 4242 4242 4242`, any future date, any CVC.

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
