# RHoSAM HCM — Standard Web App (Node.js + Express + Postgres)

Full migration of the Google Apps Script version to a standard web app on free hosting.

- **Backend:** Node.js + Express. All business logic is ported 1:1 from `Core.gs`
  and the ATS / Bank / Salary / Statutory modules — the code runs **verbatim**
  against a synchronous Postgres data layer (`src/globals.js`).
- **Database:** PostgreSQL (Supabase or Neon free tier). Tables mirror the old
  spreadsheet tabs 1:1 (see `src/config.js` → `SCHEMA`).
- **Frontend:** static files in `public/` (`index.html`, `styles.css`, `app.js`,
  `logo.js`). `app.js` is the original `ClientJS.html` with `google.script.run`
  swapped for `fetch('/api/…')`.
- **Hosting:** Render free tier (recommended) or Fly.io. See "Deploy" below.
- **Email:** Resend (free tier ~3,000 emails/month) for password-reset OTPs and
  notification digests. If `RESEND_API_KEY` is unset, emails are logged to console.

## Layout

```
webapp/
├── public/            static frontend (index.html, styles.css, app.js, logo.js)
├── scripts/           build-assets.js (regenerates logo.js from Logo.html)
├── src/
│   ├── config.js      APP/SHEETS constants + Postgres schema (tables/columns)
│   ├── globals.js     Apps Script runtime shim + synchronous Postgres data layer
│   ├── core.js        port of Core.gs (full frontend-facing API)
│   ├── modules.js     port of ATS / BankTransfer / SalaryManagement / StatutoryPayroll
│   ├── api.js         allowlist of functions exposed over POST /api/:fn
│   ├── server.js      Express server (static + API dispatch + file serving + cron)
│   └── migrate.js     one-time setup (tables + seeds + optional data import)
└── data/uploads/      uploaded files (photos, documents, chat files, payslips)
```

## 1. Set up the database (Supabase, free)

1. Create a project at https://supabase.com (free tier: 500 MB Postgres).
2. Project Settings → Database → Connection string → copy the **URI**
   (`postgres://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres`).
3. Copy `.env.example` → `.env` and fill in `DATABASE_URL`.

## 2. Run locally

```bash
cd webapp
npm install
cp .env.example .env        # fill in DATABASE_URL
npm run migrate -- --bootstrap-admin
npm start
```

Open http://localhost:3000 and sign in with `SETUP_EMAIL` / `SETUP_PASSWORD`.

- `npm run migrate` creates all ~42 tables and seeds states/departments/etc.
- `--bootstrap-admin` creates the initial Admin user (from `SETUP_EMAIL`/`SETUP_PASSWORD` env).
- `--from-sheets <spreadsheetId>` imports existing data out of your Google Sheet
  (requires `GOOGLE_SERVICE_ACCOUNT_JSON` env; see below).

## 3. Bring over your existing Google Sheets data (optional but recommended)

Because the app previously ran on Google Sheets, you can keep all your data:

1. Create a service account at https://console.cloud.google.com → IAM → Service Accounts.
2. Enable the **Google Sheets API** for the project, create a key (JSON), and
   put the JSON into `GOOGLE_SERVICE_ACCOUNT_JSON` in `.env`.
3. Share your spreadsheet with the service account email (read access).
4. Run:
   ```bash
   npm run migrate -- --bootstrap-admin --from-sheets 1AbCdef... 
   ```
   It copies every tab that matches a table name (Employees, Users, Payroll_Run, …)
   into Postgres. **Existing passwords keep working** — the hash format is unchanged.

## 4. Deploy to Render (free)

1. Push this repo (including `webapp/` and the original `Rhosam/AppScriptProject/`
   folder — `logo.js` is generated from it on first boot) to GitHub.
2. https://render.com → **New → Web Service** → pick the repo.
   - **Root directory:** `webapp`
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - Add env vars: `DATABASE_URL`, `PUBLIC_BASE_URL` (your Render URL),
     `RESEND_API_KEY`, `SETUP_EMAIL`, `SETUP_PASSWORD`.
3. Deploy. Then run the migration once against the hosted database:
   ```bash
   npm run migrate -- --bootstrap-admin
   ```
   (or run it from your machine pointed at the same `DATABASE_URL`).
4. Open the Render URL. Done.

Notes:
- Render free tier **sleeps after ~15 min idle**; the first visit after idle takes
  ~30-60s to wake. If that's a problem, deploy on **Fly.io** (always-on free allowance).
- Files (profile photos, documents, chat attachments, payslips) are stored on the
  server's local disk — on Render free tier that's ephemeral across redeploys.
  For durable storage, swap `src/globals.js` `getOrCreateFolder` for **Supabase
  Storage** (free 1 GB) — the file-shim interface is the only thing to change.
- The **daily notification digest** is a cron: on Render, use
  **Cron Jobs** → schedule `GET https://yourapp.onrender.com/cron/digest` at 07:00.
  (Or call `/cron/digest` manually.)

## API surface

The frontend calls `POST /api/:functionName` with `{ token, args: [...] }` and
receives the raw function result, or `{ error }` on failure. Only names in
`src/api.js` are exposed; `login`, `requestPasswordReset`, `completePasswordReset`
and the digest/trigger functions do not require a token.

## Known differences from the Apps Script version

| Apps Script | Web app |
|---|---|
| `google.script.run` | `fetch('/api/…')` (see `public/app.js` → `call()`) |
| Google Sheets tabs | Postgres tables (same names/columns) |
| DriveApp files | local disk + `/files/:id` (swap to Supabase Storage when needed) |
| MailApp | Resend (or console log) |
| Google Docs payslips | HTML payslip (opens in the browser, printable) |
| `installDigestTrigger` | cron → `GET /cron/digest` |
