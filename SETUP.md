# CashG — Accounts, Subscriptions & Admin Setup

CashG uses **Supabase** (free tier is enough to start) for login accounts,
subscriptions, payment proofs and notifications. Inventory records
(transactions, customers, balances) stay on each user's phone.

```
App  (index.html)   ─┐
                     ├──►  Supabase: Auth · Database · Storage · Edge Function
Admin (/admin/)     ─┘
```

Follow these steps once. Takes about 15 minutes.

---

## 1. Create a Supabase project

1. Go to <https://supabase.com> → **New project**.
2. Pick a region close to your users (e.g. **Southeast Asia (Singapore)**).
3. Save the database password somewhere safe.

## 2. Create the database

1. In your project: **SQL Editor → New query**.
2. Open [`supabase/schema.sql`](supabase/schema.sql), copy everything, paste, and click **Run**.

This creates the tables, the security rules (each user sees only their own
data), the private `payment-proofs` storage bucket, and the approve/reject
functions.

## 3. Turn off public sign-ups

Only you (the admin) should create accounts.

**Authentication → Sign In / Providers** → turn **off** "Allow new users to sign up".
Keep the **Email** provider enabled (that's how users sign in).

## 4. Create your admin login

1. **Authentication → Users → Add user → Create new user**.
   Enter your email and a strong password, and tick **Auto Confirm User**.
2. **SQL Editor**, run (with your email):

   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```

## 5. Deploy the account-management function

The admin dashboard creates accounts, resets passwords and disables users
through a small Edge Function, because that needs a secret key that must never
be in the browser.

**Option A: in the browser (easiest)**

1. Supabase → **Edge Functions → Deploy a new function → Via Editor**.
2. Name it exactly `admin-users`.
3. Replace the sample code with everything in
   [`supabase/functions/admin-users/index.ts`](supabase/functions/admin-users/index.ts), then **Deploy**.
4. Open the function's **Details** (or Settings) and turn **off** "Verify JWT with legacy secret" / "Enforce JWT verification". Save.

**Option B: with the Supabase CLI** (from this project folder, needs Node.js and npm access):

```bash
npx supabase login
npx supabase link --project-ref htvemsqubwxqoeakfjbs
npx supabase functions deploy admin-users --no-verify-jwt
```

`htvemsqubwxqoeakfjbs` is your project ref (the part before `.supabase.co` in the Project URL).
Supabase gives the function its keys automatically; you don't need to set any.
`--no-verify-jwt` is intentional: the function checks the caller's login token and admin role itself (this also works with the new `sb_publishable_` / `sb_secret_` API keys).

## 6. Connect the app

**Project Settings → API Keys**, then edit [`config.js`](config.js) (already filled in for this project):

```js
window.CASHG_CONFIG = {
    supabaseUrl: 'https://abcdefghijklmnop.supabase.co',   // Project URL
    supabaseAnonKey: 'sb_publishable_...'                   // Publishable key
};
```

> The **publishable** (anon) key is meant to be public. **Never** put a secret key (`sb_secret_…`) or the `service_role` key in
> any file of this project.

## 6b. Receipt images on ImageKit (optional)

Payment receipts are PNG images the app generates. They are uploaded to
**ImageKit** when it's set up, otherwise to the private `payment-proofs` bucket
in Supabase. Both show up in **Admin → Payments**.

1. Create a free account at <https://imagekit.io> → **Developer options**.
   Copy the **Public key** and the **Private key**.
2. Deploy the upload-signing function (same way as `admin-users`, JWT
   verification **off**), named exactly `imagekit-auth`, from
   [`supabase/functions/imagekit-auth/index.ts`](supabase/functions/imagekit-auth/index.ts):

   ```bash
   npx supabase functions deploy imagekit-auth --no-verify-jwt
   ```

3. Give it the private key: Supabase → **Edge Functions → Secrets** → add
   `IMAGEKIT_PRIVATE_KEY` = your private key (or
   `npx supabase secrets set IMAGEKIT_PRIVATE_KEY=private_...`).
4. Put the **public** key in [`config.js`](config.js): `imagekitPublicKey: 'public_...'`.

> The private key must only live in the Edge Function secrets, never in `config.js`.
> Receipts are stored under `/cashg/receipts/<user id>/` with a random file name.
> ImageKit URLs are public to anyone who has the link, so don't share them.

## 7. Put it online

Upload the whole folder to any static host with HTTPS: Netlify, Vercel,
Cloudflare Pages or GitHub Pages. No build step.

- **App:** `https://your-site/`
- **Admin dashboard:** `https://your-site/admin/`

## 8. First run

1. Open `/admin/` and sign in with your admin account.
2. **Settings:** set the Monthly and Yearly prices, **your GCash name and number**,
   and (optional) **your bank, account name and account number** (users see these
   when they pay). Leave the bank blank to offer GCash only.
3. **New Account:** create a login for a customer. Choose "No plan yet" (they pay
   in the app) or give a free trial. Copy the message with their email and
   password and send it to them.

## How subscriptions work

1. The user signs in to the app → **Subscription** → chooses **Monthly** or **Yearly**.
2. They pick **GCash** or **Bank Transfer**, send the amount to the account shown,
   then fill in the form: name, mobile, business, address, the account they paid
   from, and the **reference number** of the payment.
3. They tap **Generate Receipt** to create a PNG receipt with all the details
   (they can save it), then **Send Receipt**.
4. It shows up in **Admin → Payments** as *Pending*. Open it to see the details and
   the receipt image, check the reference number against your GCash / bank
   history, then **Approve** or **Reject** (with an optional note).
5. Approving adds 1 month or 1 year, starting after their current plan ends. The
   user gets a notification in the app, and the Subscription page shows the dates
   and days left.
6. Reminders appear in the app 7 days before expiry. When a plan expires, the
   inventory becomes **read-only** until they renew. Their records are never deleted.

You can also add time manually (cash payment, free extension), end access, reset
a password, disable an account, or send a message from **Admin → Accounts →
(click a user)**.

## Announcements

**Admin → Notifications** sends an announcement to many users at once. It shows
up in each user's bell next to their payment updates.

- Pick a kind (**Announcement**, **Update**, **Reminder** or **Urgent**), write a
  title and message, and choose who gets it: all users, users with an active plan,
  users whose plan expired, or users who never had a plan.
- The **Sent announcements** list shows how many users got each one and how many
  opened it. Deleting an announcement removes it from every user's notifications.
- Only users who exist when you send it receive it. Accounts created later won't
  see older announcements.

If you set up the database before this feature existed, run the
"Announcements" part of [`supabase/schema.sql`](supabase/schema.sql) once in the
SQL Editor. Running the whole file again also works.

## Updating the app later

After changing any app file, bump `CACHE_VERSION` in [`sw.js`](sw.js) (for example
`'v9'` → `'v10'`) so installed apps download the new version.
