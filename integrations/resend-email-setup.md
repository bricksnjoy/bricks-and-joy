# Email through Resend — setup

The app sends email through the **`send-email`** Edge Function, which keeps the
Resend API key on the server. That is what makes attachments and scheduled
sending possible, and it stops the key being lifted out of the browser bundle.

Until this is set up, email still goes out the old way (EmailJS, straight from
the browser) — nothing breaks, you just don't get attachments or automation.

---

## 1. Get a Resend API key

1. Sign up at <https://resend.com> (free tier is ~3,000 emails a month).
2. **API Keys → Create API Key**, permission **Sending access**.
3. Copy it — it is shown once. It looks like `re_xxxxxxxx`.

## 2. Verify bricksandjoy.com

Skip this and mail can only go to your own address, from `onboarding@resend.dev`.
Verifying lets you send from `orders@bricksandjoy.com` to anyone.

1. **Domains → Add Domain** → `bricksandjoy.com`.
2. Resend shows three DNS records to add — an `MX` and two `TXT`
   (DKIM and SPF). Add them where your domain's DNS lives (the registrar, or
   Vercel if the nameservers point there).
3. Press **Verify**. It usually takes a few minutes; DNS can take up to an hour.

Add a DMARC record too — it is not required, but without one some inboxes are
harsher on new senders:

| Type | Name | Value |
|---|---|---|
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:bricknjoy@gmail.com` |

## 3. Set the secrets

In **Supabase → Edge Functions → Secrets** (or with the CLI):

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
supabase secrets set EMAIL_FROM="Brick's & Joy <orders@bricksandjoy.com>"
supabase secrets set EMAIL_REPLY_TO="bricknjoy@gmail.com"
```

Leave `EMAIL_FROM` unset until the domain is verified — the function falls back
to Resend's sandbox sender, which only reaches your own address.

`monthly-report` reads `REPORT_FROM` for its own sender; set that the same way
if you want the report to come from the verified domain too.

## 4. Deploy the function

```bash
supabase functions deploy send-email
```

**Do not add `--no-verify-jwt`.** The function checks that a signed-in user is
behind every call, so it can never become an open relay for spam.

## 5. Check it works

Open the back office → **Message Center**, send yourself an email. If it
arrives from your verified domain, the new route is live. If it still arrives
from Gmail, the app fell back to EmailJS — see below.

---

## Scheduling (email that sends itself)

This is the reason for doing any of it: a function can be called by the database
on a timetable, whether or not anyone has the app open. `monthly-report` is
already written for this. Enable the extensions once:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

Then schedule a call. Replace `<PROJECT_REF>` and `<SERVICE_ROLE_KEY>`
(Supabase → Project Settings → API):

```sql
-- Monthly report, 07:00 UTC on the 1st
select cron.schedule(
  'monthly-report',
  '0 7 1 * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/monthly-report',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
```

Useful afterwards:

```sql
select * from cron.job;                      -- what is scheduled
select * from cron.job_run_details           -- did it run
  order by start_time desc limit 20;
select cron.unschedule('monthly-report');    -- stop it
```

The service role key is a full-access credential. It is fine inside a database
job, which nobody outside Supabase can read — never put it in the app.

---

## Attachments

Only the Resend route can carry them. From the app:

```js
import { sendEmail, toAttachment } from '../lib/emailer'

await sendEmail({
  to: 'supplier@example.com',
  subject: 'Order request — Batch 4',
  text: 'The order sheet is attached.',
  attachments: [await toAttachment('batch-4.pdf', pdfBlob)],
})
```

Total attachments are capped at 8 MB.

---

## If mail still comes from Gmail

The app falls back to EmailJS when the function is unreachable, so check in
order:

1. **Function deployed?** `supabase functions list`
2. **Key set?** A missing `RESEND_API_KEY` makes the function answer
   `not_configured`, and the app falls back on purpose.
3. **Logs** — Supabase → Edge Functions → `send-email` → Logs shows the reason
   for every refusal.
4. **Domain not verified** — Resend rejects any recipient other than your own
   address until it is.

## While EmailJS is still in use

Its keys are inside the published JavaScript, so anyone can read them and send
mail on your quota. In the EmailJS dashboard, restrict sending to
`bricksandjoy.com` under the account's allowed origins. Worth doing whatever you
decide about Resend.
