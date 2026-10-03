# Manual test checklist — PayFast sandbox

Run this against a deployed preview (Vercel) with the sandbox credentials, after the setup below.
It covers the whole membership path: sign up, sign in, pay, return, cancel, and the admin side.
Nothing in this flow sends an e-mail — not the app, not Supabase.

## Setup (once)

1. Supabase → SQL editor: run `supabase/schema.sql`, then `supabase/seed_centres.sql`.
2. Supabase → Authentication → Providers → Email: enabled, **Confirm email OFF**, minimum password
   length 8. Leave **Project Settings → Auth → SMTP empty** — this app needs no mail server.
3. Supabase → Authentication → URL Configuration: the site URL and redirect URLs do not matter for
   sign-in any more (no confirmation or reset link is generated), but keep them pointing at the site.
4. Vercel → Environment Variables: `SITE_URL` = the deployed origin (no trailing slash),
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `PAYFAST_MERCHANT_ID` / `PAYFAST_MERCHANT_KEY` / `PAYFAST_PASSPHRASE` from the PayFast sandbox,
   `PAYFAST_SANDBOX=true`, `SUBSCRIPTION_AMOUNT=100`, `TRIAL_DAYS=7`, `GRACE_DAYS=3`.
5. Deploy, open the site, create an account, then make it the first admin in the SQL editor:
   `update public.members set is_admin = true where lower(email) = lower('you@example.org');`

## 1. Sign up

- [ ] Cold load (private window) shows only the sign-in gate. The compass, tabs and location are not
      reachable, and the browser never asks for location or motion permission.
- [ ] **Create account** tab: a 7-character password is refused as you type; `abcdefgh` (no digit) is
      refused; a 73-character password is refused; two different passwords say "do not match".
- [ ] A valid sign-up goes **straight in** — there is no "check your e-mail" step, and no mail arrives.
- [ ] The one-time welcome page appears: 7 days free, the six features, "R100 per month after the
      trial, cancel any time".
- [ ] **Start my free trial** → the app opens, the header chip reads `Trial · 7d`.
- [ ] Sign out and back in: the welcome page does **not** appear again (it is stored per e-mail in
      `localStorage` under `tshk-welcome`).
- [ ] Signing up with an existing address says "That e-mail already has an account. Please sign in."

## 2. Sign in

- [ ] A wrong password says "Wrong e-mail or password", the password box is cleared, and no mail is sent.
- [ ] Repeated failures eventually report the rate limit ("Too many attempts…").
- [ ] There is no "forgot password" link — the card explains that an admin resets it instead.

## 3. Pay in the sandbox

- [ ] Welcome page or paywall → **Pay now** → the browser posts to `sandbox.payfast.co.za`.
- [ ] On the PayFast page: amount R100.00, item name correct, and it is a **subscription**
      (monthly), not a one-off.
- [ ] Complete the payment with the sandbox test card.
- [ ] Return lands on `/?payment=success`, shows "Confirming your payment…", and the query string is
      removed from the address bar once access is granted.
- [ ] Within ~60 s the app opens. If the ITN is slow you get "Payment received? It can take a minute.
      Check again." with a working button.
- [ ] Account now reads "Active until <date>, then it renews", shows **Cancel subscription**, and no
      longer shows Pay now.
- [ ] Cancelling from PayFast's side instead: **Cancel** on the PayFast page returns with
      `?payment=cancelled` and the paywall says payment was cancelled.
- [ ] DevTools → Network: no request contains a password or an access token in its URL; the console
      logs neither.

## 4. Cancel

- [ ] Account → **Cancel subscription** → the button asks for a second tap → confirm.
- [ ] The status line becomes "Cancelled. Access until <date>"; the app keeps working until then.
- [ ] The PayFast sandbox dashboard shows the subscription cancelled.
- [ ] After `paid_through` passes (edit the row in the SQL editor to test), the paywall returns.

## 5. Admin: reset a password

- [ ] As a non-admin, the Account screen has **no** Admin button.
- [ ] As an admin: Account → **Admin** → Members. The list shows e-mail, state, trial end or
      paid-through, and flags (`must change password`, `subscription`).
- [ ] Your own row and other admins' rows have **no** action buttons.
- [ ] Search filters by e-mail.
- [ ] **Auto-generate password** → confirm → the password appears **once** in a dialog with a Copy
      button and "Give this to the member. They must change it when they sign in."
- [ ] Closing the dialog removes the password from the page (view source / inspect: it is gone) and it
      is not in `localStorage`. It never appears in a URL or in the browser console.
- [ ] Sign in as that member with the temporary password → the blocking **Choose a new password**
      screen appears; nothing else is reachable except Sign out.
- [ ] A weak or mismatched new password is refused; a valid one saves, `/api/me` is refreshed, and the
      app opens. The `must change password` flag is gone from the admin list.

## 6. Admin: delete a member

- [ ] **Delete user** → a dialog asks you to type the member's e-mail; Confirm stays disabled until it
      matches, and it warns that an active subscription is cancelled first.
- [ ] Deleting a member with an active subscription cancels it, then deletes.
- [ ] If PayFast cannot cancel, you get a 502 and a second, explicit **Delete anyway** — only that
      resends the request with `force: true`.
- [ ] The member disappears from the list, and their session no longer works (`/api/me` → 401 →
      they are signed out on the next check).

## 7. Admin: centres

- [ ] Centres tab: grouped by region, with a region filter and region suggestions on the form.
- [ ] Validation matches the server: no name → "A name is needed"; no region → refused; one of
      latitude/longitude alone → refused; `91` latitude or `181` longitude → out of range; a phone with
      letters → refused. Nothing is sent while the form is invalid.
- [ ] A valid add appears in the list **and** in the member app's Centres tab after a reload.
- [ ] Edit fills the form, saves with a PATCH, and shows the new values.
- [ ] Delete asks first, then removes the centre.

## 8. Access rules and offline

- [ ] Airplane mode with a previously valid session: the app still works, and the Centres tab says
      "Offline copy".
- [ ] Airplane mode after `access_until` has passed: "Connect to the internet to check your membership"
      with Try again.
- [ ] Back online: access is re-checked within 15 minutes, on returning to the tab, and on reload —
      a cached "access" is never trusted while online.
- [ ] A late charge inside the 3-day grace period keeps access and shows "Payment is late: please
      check your payment".
- [ ] Signing out clears `tshk-session`, and `dashboard.html` then asks you to sign in again.

## 9. Store build (optional)

- [ ] With `STORE_BUILD: true` in `public/config.js`, the paywall still appears but shows no PayFast
      button, and the wording asks the member to sign in with a member account.

## What the automated tests do cover

`.github/workflows/tests.yml` runs on every push and pull request to `main`, on
Ubuntu with Node 22, PHP 8.2 and a real Chromium:

- **Unit and API: 101 tests, 0 skipped.** PHP is installed, so the six tests that
  compare the Node signing code against PayFast's own PHP reference
  (`tests/unit/php-reference.php`) byte for byte all run and pass — the
  checkout, ITN and API signatures included. Several cover things that fail
  quietly: the 20 s ceiling on every call (the button is disabled while the call
  is in flight, then the abort timer re-enables it and the member is told why),
  the 15-minute re-check of `/api/me`, the web app manifest — its required
  fields, that `index.html` links it, that every icon it names is a real PNG, and
  that each file's true pixel size matches the size declared beside it — and every
  entitlement state the server actually emits (`trial`, `active`, `cancelled`,
  `trial_ended`, `past_due`, `expired`, `none`).
- **Browser: 88 assertions.** `tests/e2e/paywall.test.cjs` drives the whole
  membership flow in Chromium against a mocked backend: sign-up with no
  confirmation e-mail, the one-time welcome page, the paywall and the signed
  PayFast form it posts, `?payment=success` polling, the forced password change,
  402/403 from `/api/centres`, the offline rule against `access_until`, the admin
  area, the cancel flow, the 320px layout with its 44px controls, and the
  keyboard focus ring. It also registers the **real** service worker and reads
  its `Cache`, which the jsdom suite cannot do — proving nothing under `/api/*`,
  no Supabase or PayFast call and no one-use page is ever stored, while the app
  shell is, all under the versioned cache name. That exercises
  `caches.addAll(CORE)` for real, so a missing shell file fails here.
- **True offline.** After the worker has cached the shell, the suite calls
  `setOffline(true)`, installs an abort-all route, and reloads — so the network
  is genuinely dead, not merely reported as down. The app still opens from the
  cached shell, the centres still render, and they are labelled as an offline
  copy. This is the promise the PWA makes, and it is now proven rather than
  assumed.

## What has not been verified automatically

Everything above is a manual run for that reason. These are the things the
automated tests in this repository could **not** prove:

- **Nothing has touched your real Supabase project, Vercel deployment or PayFast
  sandbox account.** The app was exercised against a local mock of the same
  contract, so an environment mistake (wrong key, missing passphrase,
  subscriptions not enabled on the PayFast account, RLS policy missing) will
  only show up in the steps above.
- **E-mail confirmation is assumed OFF.** If your Supabase project still has
  "Confirm email" enabled, sign-up returns no session and the app says the
  account still asks for confirmation. Turn it off; there is deliberately no
  client-side workaround.
- **Real-device behaviour.** The browser suite runs in Chromium with
  `isMobile: true`, so the layout engine and the sensor/geolocation spies are
  real: it proves the centres tab starts no compass sensors; a step at
  **320×700** proves the gate and the open app do not scroll sideways, no element
  extends past the viewport, every gate button really renders 44px tall and every
  input has a label; and a step walking the real Tab order proves the
  `:focus-visible` ring is applied and at least 2px wide. Chromium still cannot
  cover safe-area insets on a notched phone, the iOS motion-permission prompt, or
  the PWA install prompt itself. Check those on a phone.
- **The 378 Portuguese, Chichewa and iciBemba strings need a native speaker.**
  See `docs/translations-to-review.md`.
- **The `grace` branch is defensive.** The client renders a "payment is late"
  message for `state: "grace"`, but `api/_lib/entitlement.js` never returns that
  value — a late payment comes back as `past_due`, and that path **is** tested.
  The `grace` wording therefore cannot be exercised by a real payment; it is left
  in place in case the server starts emitting it.
- **`state: "none"` needed its own wording.** An account with no row in `members`
  (one created in the Supabase dashboard, or a sign-up whose insert failed) used
  to fall through to "Your free trial has ended" — a trial it never had. It now
  reads "No active membership" in all five languages. Test 94 covers it.
