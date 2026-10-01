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

## Initial accounts

- The initial admin is `asiegbukelvin3974@gmail.com`; its name and password come from `ADMIN_NAME` and `ADMIN_PASSWORD` in `.env`.
- New staff must register and be approved by the admin; no demo staff accounts are seeded.

New signups are stored as unapproved accounts and cannot sign in until an admin approves them and chooses Call agent or Contact generator. Passwords are bcrypt-hashed, sessions use signed HttpOnly cookies, and role checks are enforced by the API.

Contact generators submit one or many businesses for admin review. Admins can add these to a daily batch, review/reorder the calls, and share them evenly among approved Call agents. Staff call outcomes, notes, and daily clock-in/out times are stored in PostgreSQL.

Do not commit `.env`. For production, use a managed PostgreSQL service, HTTPS, a strong unique `JWT_SECRET`, and a production reverse proxy that routes `/api` to the Express server.
