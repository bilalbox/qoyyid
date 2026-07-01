# Cloud orchestrator deployment

## Local dev

```bash
cd cloud
npm install
cp .env.example .env   # fill in MISTRAL_API_KEY, GOOGLE_CLIENT_ID/SECRET, ADMIN_EMAILS
npm run db:migrate:local
npm run dev
```

`wrangler dev` reads secrets from `.env` (or `-e/--env-file`) automatically.

Google OAuth requires `http://localhost:8787/auth/google/callback` registered as an
authorized redirect URI on the Google OAuth client used for `GOOGLE_CLIENT_ID`.

Mistral has no documented sandbox/mock mode — local testing hits the real API and
costs real (small) money. Budget a handful of test pages.

## One-time setup

1. Create remote R2 bucket `qoyyid-jobs` and D1 database `qoyyid-jobs` in the Cloudflare
   dashboard (already done for this project — `database_id` is set in `wrangler.jsonc`).
2. Apply migrations remotely:

```bash
cd cloud
npx wrangler d1 migrations apply qoyyid-jobs --remote
```

3. Set production secrets from the same `.env` file, in one shot (do **not** commit
   `.env` — applies additively, safe to re-run, never deletes existing secrets):

```bash
npx wrangler deploy --secrets-file=.env
```

   Or set them one at a time instead:

```bash
npx wrangler secret put MISTRAL_API_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put ADMIN_EMAILS   # comma-separated list of admin emails
```

4. Deploy (if you didn't already via `--secrets-file` above):

```bash
npx wrangler deploy
```

Worker URL: `https://qoyyid.23p.dev` (custom domain route, see `wrangler.jsonc`).

## Admin bootstrap

The first login from an email listed in `ADMIN_EMAILS` is automatically granted
`is_admin = 1` and bypasses the invite requirement — no manually pre-seeded `invites`
row is needed for the first admin account.
