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

## What has not been verified automatically

Everything above is a manual run for that reason. These are the things the
automated tests in this repository could **not** prove:

- **The Playwright suite has never been executed.** `npm run test:e2e` needs a
  Chromium binary and none could be downloaded in the environment where this was
  written. Its selectors are checked against the shipped DOM by
  `npm test` (which reads `tests/e2e/paywall.test.cjs` and probes the real
  pages), so a renamed id fails there — but the flows themselves have only been
  run in jsdom, not in a browser.
- **The PayFast signature comparisons are skipped.** Six tests in
  `tests/unit/` compare the Node signing code against PayFast's own PHP
  reference (`tests/unit/php-reference.php`) byte for byte. They skip when PHP
  is not on the PATH. Run `npm test` on a machine with PHP installed and confirm
  they pass before going live; that is the only proof the signatures will
  validate on PayFast's server.
- **Nothing has touched your real Supabase project, Vercel deployment or PayFast
  sandbox account.** The app was exercised against a local mock of the same
  contract, so an environment mistake (wrong key, missing passphrase,
  subscriptions not enabled on the PayFast account, RLS policy missing) will
  only show up in the steps above.
- **E-mail confirmation is assumed OFF.** If your Supabase project still has
  "Confirm email" enabled, sign-up returns no session and the app says the
  account still asks for confirmation. Turn it off; there is deliberately no
  client-side workaround.
- **Real-device behaviour.** jsdom has no layout engine, no sensors and no
  service worker, so the 320px layout, safe-area insets, focus rings, iOS
  motion-permission prompts, PWA install and true offline behaviour are
  unverified. Check them on a phone.
- **The 378 Portuguese, Chichewa and iciBemba strings need a native speaker.**
  See `docs/translations-to-review.md`.
- **Grace-period rendering is defensive.** The client shows a "payment is late"
  message for `state: "grace"`, but `api/_lib/entitlement.js` does not currently
  produce that value. The wording is untested against a real late payment.
