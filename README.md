# Flux Dev Staff Portal

A staff calling and contact-generation portal backed by PostgreSQL. Staff accounts, approval state, roles, work shifts, generated contacts, and call assignments are stored server-side.

## Project layout

- `frontend/` contains the React UI, static assets, HTML entry point, and Vite configuration.
- `backend/server/` contains the Express API and authentication middleware.
- `backend/db/` contains the PostgreSQL schema and database setup script.
- `package.json` at the root holds shared dependencies and commands for both sides.

## Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer, running locally or hosted

## Configure the database

```bash
npm install
Copy-Item .env.example .env
```

Edit `.env` and set `DATABASE_URL`, `JWT_SECRET`, and a strong `ADMIN_PASSWORD` (at least 12 characters). `db:setup` creates the named database if it does not exist, creates the tables and indexes, removes legacy demo accounts, and initializes the admin account.

Initialize the database:

```bash
npm run db:setup
```

Start the API and Vite client together from the project root:

```bash
npm run dev
```

Open the local URL printed by Vite. The Vite development server proxies `/api` requests to the Express API on port 3001. Build check: `npm run build`.

## Deploy the app to Vercel

Set the Vercel project root to the repository root, build command to `npm run build`, and output directory to `dist`. The `api/[...path].js` function runs the Express API on Vercel; `backend/server/app.js` detects Vercel and does not start a separate listener.

Vercel hosts the frontend and API; the app still needs a hosted PostgreSQL database. Use an external connection URL reachable from Vercel. In Vercel Project Settings, add these variables for each deployment environment:

- `DATABASE_URL`: the hosted PostgreSQL connection string.
- `PGSSL`: set to `true` if the provider requires SSL.
- `JWT_SECRET`: a stable random secret of at least 32 characters.
- `PGPOOL_MAX`: optional; defaults to `1` on Vercel to limit connections per function instance.

Initialize the hosted database schema and admin account once using the provider's connection URL locally. Set `DB_CREATE_IF_MISSING=false` if the provider already created the database, plus `DATABASE_URL`, `PGSSL` if required, `JWT_SECRET`, `ADMIN_EMAIL`, and an `ADMIN_PASSWORD` of at least 12 characters, then run `npm run db:setup`. Never commit `.env` or database credentials.

Before deploying lead activity tracking to an existing database, run `npm run db:migrate:lead-activity` once with `DATABASE_URL` configured locally. This adds an assignment timestamp and index without changing existing records or the admin password.

For an existing database, run `npm run db:migrate:lead-submissions` after deploying this version. Unassigned existing leads and new submissions wait for admin approval; leads already assigned to call agents remain unchanged. Lead agents can check progress in **My leads**. Admins review submissions in **Today’s leads**, where contacts matching a previously approved business name or phone number are flagged and excluded from selection. New contacts are selected by default; admins can adjust the selection, delete unwanted leads, and approve only selected contacts to move them to **Today’s calls** for review and sharing with call agents.

## Initial accounts

- The initial admin is `asiegbukelvin3974@gmail.com`; its name and password come from `ADMIN_NAME` and `ADMIN_PASSWORD` in `.env`.
- New staff must register and be approved by the admin; no demo staff accounts are seeded.

New signups are stored as unapproved accounts and cannot sign in until an admin approves them and chooses Call agent or Contact generator. Passwords are bcrypt-hashed, sessions use signed HttpOnly cookies, and role checks are enforced by the API.

Contact generators submit one or many businesses for admin review. Admins can add these to a daily batch, review/reorder the calls, and share them evenly among approved Call agents. Staff call outcomes, notes, and daily clock-in/out times are stored in PostgreSQL.

Do not commit `.env`. For production, use a managed PostgreSQL service, HTTPS, and a strong stable `JWT_SECRET`.
