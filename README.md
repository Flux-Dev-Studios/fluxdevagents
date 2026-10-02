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
- A PostgreSQL user allowed to create the app database (or use an existing database)

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

## Deploy the frontend to Vercel with the API on Render

Set the Vercel project root to the repository root, build command to `npm run build`, and output directory to `dist`. The `api/[...path].js` function forwards `/api/*` requests to the Render API, keeping browser requests same-origin so the session cookie works without cross-origin CORS settings.

Set `RENDER_API_URL` in Vercel Project Settings for Production, Preview, and Development to the Render Web Service base URL, for example `https://your-api.onrender.com` (no `/api` suffix). Vercel does not need `DATABASE_URL` or `JWT_SECRET` for this setup.

On Render, run the Web Service with `npm run api`. Set `NODE_ENV=production`, the Render Postgres internal `DATABASE_URL`, and a stable `JWT_SECRET` of at least 32 characters. Set `PGSSL=true` if required by your database provider. Do not set `SERVE_FRONTEND=true`; Vercel serves the frontend. Set the Render health check path to `/api/health`.

Initialize the Render database once using its external connection URL from your computer. Set `DB_CREATE_IF_MISSING=false` for that run, plus `JWT_SECRET`, `ADMIN_EMAIL`, and an `ADMIN_PASSWORD` of at least 12 characters, then run `npm run db:setup`. Never commit `.env` or database credentials.

## Deploy the full app to Render

Create a Render PostgreSQL database and a Web Service from this repository. Use the repository root as the service root directory, `npm install && npm run build` as the build command, and `npm run api` as the start command. Set `SERVE_FRONTEND=true` so Express serves the built frontend from `dist` alongside the `/api` routes. Set the health check path to `/api/health`.

Add `NODE_ENV=production`, `SERVE_FRONTEND=true`, the database's internal `DATABASE_URL`, and a unique `JWT_SECRET` of at least 32 characters to the Render Web Service environment. Set `PGSSL=true` if required by the database provider. Choose paid service and database plans for an always-on deployment; free plans may sleep or expire.

Initialize the Render database once from your computer using its external connection URL in your local, git-ignored `.env`. Set `DB_CREATE_IF_MISSING=false` for that run because Render has already created the database, then run `npm run db:setup`. For PowerShell:

```powershell
$env:DB_CREATE_IF_MISSING = 'false'
npm run db:setup
Remove-Item Env:DB_CREATE_IF_MISSING
```

Your local `.env` must also contain `JWT_SECRET`, `ADMIN_EMAIL`, and an `ADMIN_PASSWORD` of at least 12 characters. Never commit it.

## Initial accounts

- The initial admin is `asiegbukelvin3974@gmail.com`; its name and password come from `ADMIN_NAME` and `ADMIN_PASSWORD` in `.env`.
- New staff must register and be approved by the admin; no demo staff accounts are seeded.

New signups are stored as unapproved accounts and cannot sign in until an admin approves them and chooses Call agent or Contact generator. Passwords are bcrypt-hashed, sessions use signed HttpOnly cookies, and role checks are enforced by the API.

Contact generators submit one or many businesses for admin review. Admins can add these to a daily batch, review/reorder the calls, and share them evenly among approved Call agents. Staff call outcomes, notes, and daily clock-in/out times are stored in PostgreSQL.

Do not commit `.env`. For production, use a managed PostgreSQL service, HTTPS, a strong unique `JWT_SECRET`, and a production reverse proxy that routes `/api` to the Express server.
