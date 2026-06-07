# VIN Demo — Web (login + operator console)

Next.js (App Router, TypeScript) implementation of the **login** and **operator console**
designs, ported pixel-faithfully from `VIN Demo/` (Claude Design handoff). Hosted on
**Railway**, gated by login, served at **demofor.vin**.

## Local dev

```bash
cd apps/web
npm install
cp .env.example .env.local   # set ADMIN_EMAIL / ADMIN_PASSWORD
npm run dev                  # http://localhost:3000  → redirects to /login
```

## Auth

- The whole console is gated by `middleware.ts` (session cookie). Unauthenticated → `/login`.
- Credentials are validated in `lib/auth.ts` against **seeded users from env** (so secrets
  never live in git): `ADMIN_EMAIL` + `ADMIN_PASSWORD`, plus optional `SEED_USERS` (JSON).
- Seeded admin for this environment: `johndean@vin.com` (password in `.env.local`, **rotate**).

## Deploy to Railway (demofor.vin)

1. New Railway service → connect this repo, set **Root Directory** to `apps/web`.
2. Builder = **Dockerfile** (picked up from `railway.json` / `Dockerfile`).
3. Set env vars: `ADMIN_EMAIL`, `ADMIN_PASSWORD` (and `SEED_USERS` if needed). `PORT` is
   provided by Railway.
4. Add the custom domain **demofor.vin** to the service and point its DNS (CNAME) at the
   Railway target.

## Structure

- `app/login/` — pixel-faithful sign-in (navy gradient + VIN hatch, compact card, ViN
  wordmark + Demo chip, gold version pill).
- `app/(console)/` — the gated operator console (full 12-view port in progress).
- `app/api/auth/` — login / logout.
- `app/globals.css` — the VIN design tokens (ported from `colors_and_type.css`).
- `public/fonts`, `public/assets` — Proxima Nova + VIN logos/icons.
