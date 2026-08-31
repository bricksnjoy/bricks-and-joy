# Email through Resend — setup

The app sends email through the API's **`/api/functions/send-email`** route, which keeps the
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

In **`server/.env` on the VPS** (or with the CLI):

```bash
# in server/.env:  RESEND_API_KEY=re_xxxxxxxx
# in server/.env:  EMAIL_REPLY_TO="bricknjoy@gmail.com"
# optional — only to send from a different address than the monthly report
# in server/.env:  EMAIL_FROM="Brick's & Joy <orders@bricksandjoy.com>"
```

Only `RESEND_API_KEY` is required. The sender falls back to `REPORT_FROM` (which
`monthly-report` already uses), then to Resend's sandbox address, which reaches
your own inbox only. So if the monthly report already sends correctly, there is
nothing more to configure here.

## 4. Deploy the function

```bash
sudo systemctl restart bricksnjoy-api
```

**Do not add `--no-verify-jwt`.** The function checks that a signed-in user is
behind every call, so it can never become an open relay for spam.

## 5. Check it works

Open the back office → **Message Center**, send yourself an email. If it
arrives from your verified domain, the new route is live. If it still arrives
from Gmail, the app fell back to EmailJS — see below.

---

## Scheduling (email that sends itself)

This is the reason for doing any of it: the report goes out whether or not
anyone has the app open. It is already scheduled — the API runs its own timer
(`server/cron.js`), so there is nothing to set up and no key to pass around.

| job | when | change it with |
|---|---|---|
| monthly report | 07:00 on the 1st | `CRON_MONTHLY_REPORT` in `server/.env` |
| campaign reminders | 08:00 daily | `CRON_CAMPAIGN_REMINDERS` |

Times are in the shop's own timezone (`TZ`, default `Indian/Maldives`), so 7am
means seven in the morning in Malé.

To send one now without waiting for the 1st, use **Settings → Monthly report →
Send test**, or from the server:

```bash
cd /srv/bricksandjoy/server
node -e "require('dotenv').config();require('./jobs/monthlyReport').runMonthlyReport({test:true}).then(console.log)"
```

Check it ran:

```bash
sudo journalctl -u bricksnjoy-api | grep cron
# [cron] monthly-report finished in 812ms: {"ok":true,"sent_to":["you@example.com"],...}
```

Set `CRON_ENABLED=false` to stop all of them.

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

The app falls back to EmailJS when the API is unreachable, so check in order:

1. **API up?** `curl -s localhost:4000/api/health`
2. **Key set?** A missing `RESEND_API_KEY` makes the route answer
   `not_configured`, and the app falls back on purpose. After editing
   `server/.env`, restart: `sudo systemctl restart bricksnjoy-api`.
3. **Logs** — `sudo journalctl -u bricksnjoy-api -f` shows the reason for every
   refusal.
4. **Domain not verified** — Resend rejects any recipient other than your own
   address until it is.

## While EmailJS is still in use

Its keys are inside the published JavaScript, so anyone can read them and send
mail on your quota. In the EmailJS dashboard, restrict sending to
`bricksandjoy.com` under the account's allowed origins. Worth doing whatever you
decide about Resend.
