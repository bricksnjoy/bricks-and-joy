# Bricks & Joy — Setup Guide
## From zero to live in ~20 minutes

---

## STEP 1 — Create your Supabase database (5 min)

1. Go to **https://supabase.com** → click "Start your project" → sign up free
2. Click **"New project"**, name it `bricks-and-joy`, choose a strong password, pick the region closest to you (e.g. Singapore for Maldives)
3. Wait ~2 minutes for the project to spin up
4. In the left sidebar, click **"SQL Editor"**
5. Click **"New query"**, paste the entire contents of `supabase_schema.sql`, click **"Run"**
6. You should see "Success. No rows returned" — your tables are ready

**Get your API keys:**
- Left sidebar → **Project Settings** → **API**
- Copy **"Project URL"** (looks like `https://xxxx.supabase.co`)
- Copy **"anon public"** key (long string starting with `eyJ...`)

---

## STEP 2 — Set up the app on your computer (5 min)

You need **Node.js** installed. If you don't have it:
→ Download from **https://nodejs.org** → install the LTS version

Then open a terminal (Command Prompt on Windows, Terminal on Mac):

```bash
# 1. Go into the app folder
cd bricks-and-joy

# 2. Install dependencies
npm install

# 3. Create your environment file
cp .env.example .env
```

Now open the `.env` file in any text editor and replace the placeholders:
```
REACT_APP_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
REACT_APP_SUPABASE_ANON_KEY=eyJ...your anon key here...
```

```bash
# 4. Run locally to test
npm start
```

Your browser will open at **http://localhost:3000** — the app is running!

---

## STEP 3 — Create your team accounts (2 min)

1. Open the app → click "Sign up"
2. Create account for yourself
3. Share the URL with your colleague → they sign up too
4. Each person has their own login — all data is shared in real time

---

## STEP 4 — Deploy live so anyone can access it (8 min)

### Option A: Vercel (recommended, free)

1. Create a free account at **https://vercel.com**
2. Install Vercel CLI:
   ```bash
   npm install -g vercel
   ```
3. From the `bricks-and-joy` folder, run:
   ```bash
   vercel
   ```
   Follow the prompts (accept all defaults)
4. When asked about environment variables, add:
   - `REACT_APP_SUPABASE_URL` → your Supabase URL
   - `REACT_APP_SUPABASE_ANON_KEY` → your anon key
5. Your app is live at something like `https://bricks-and-joy.vercel.app`

### Option B: Netlify (also free)

1. Run `npm run build` — creates a `build/` folder
2. Go to **https://netlify.com** → drag and drop the `build/` folder onto the dashboard
3. Add environment variables in: Site settings → Environment variables
4. Done!

---

## STEP 5 — Install as desktop app (PWA)

Once the app is live on a URL:

**On Chrome (Windows/Mac):**
1. Open your app URL in Chrome
2. Look for the install icon in the address bar (looks like a computer with a down arrow)
3. Click it → "Install"
4. The app appears on your desktop like a native app

**On Edge:**
1. Open the URL → click the `...` menu → "Apps" → "Install this site as an app"

**On mobile:**
1. Open the URL in Safari (iPhone) or Chrome (Android)
2. Tap Share → "Add to Home Screen"

---

## STEP 6 — Add your Instagram DM integration (optional)

See the Instagram setup guide (coming separately). This requires:
- A Meta Business account
- Connecting your Instagram to a Facebook Page
- A webhook URL from your deployed app

---

## Folder structure

```
bricks-and-joy/
├── public/
│   ├── index.html          ← PWA-ready HTML
│   └── manifest.json       ← Makes it installable as desktop app
├── src/
│   ├── App.js              ← Main app, routing, auth
│   ├── index.js            ← Entry point
│   ├── lib/
│   │   └── supabase.js     ← Database connection
│   ├── components/
│   │   └── UI.js           ← Shared components (Button, Table, Modal...)
│   └── pages/
│       ├── Login.js        ← Sign in / sign up
│       ├── Dashboard.js    ← Overview & alerts
│       ├── Inventory.js    ← Products & stock
│       ├── Orders.js       ← Customer orders
│       ├── Customers.js    ← Customer management
│       ├── PurchaseOrders.js ← Supplier orders
│       ├── ProfitLoss.js   ← P&L statement & expenses
│       └── Statistics.js   ← Charts & analytics
├── supabase_schema.sql     ← Run this in Supabase SQL Editor
├── .env.example            ← Copy to .env and fill in keys
└── package.json
```

---

## Troubleshooting

**"Invalid API key" error:**
→ Double-check your `.env` file values match exactly what's in Supabase dashboard

**"relation does not exist" error:**
→ The SQL schema wasn't run — go back to Step 1 and run `supabase_schema.sql`

**App won't start (`npm start` fails):**
→ Make sure Node.js is installed: run `node --version` in terminal

**Changes not saving:**
→ Check your Supabase project isn't paused (free tier pauses after 1 week of inactivity)
→ Go to https://supabase.com → your project → click "Restore"

---

## Security notes

- Never share your `.env` file or commit it to GitHub
- The `anon` key is safe to use in the frontend — Supabase Row Level Security protects your data
- Only authenticated users (your team) can read or write data

---

*Built for Bricks & Joy Toy Company*
