# Cloud orchestrator deployment

## Local dev

```bash
pnpm install
cp .env.example .env   # MISTRAL_API_KEY, GOOGLE_CLIENT_ID/SECRET, ADMIN_EMAILS, …
pnpm db:migrate:local
pnpm dev
```

`wrangler dev` reads secrets from `.env` (or `-e/--env-file`) automatically.

Google OAuth requires `http://localhost:8787/auth/google/callback` registered as an
authorized redirect URI on the Google OAuth client used for `GOOGLE_CLIENT_ID`.

Mistral has no documented sandbox/mock mode — local testing hits the real API and
costs real (small) money. Budget a handful of test pages.

## One-time setup

1. Create remote R2 bucket `qoyyid-assets` and D1 database `qoyyid-jobs` in the Cloudflare
   dashboard (`database_id` is set in `wrangler.jsonc`).
2. Apply migrations remotely:

```bash
pnpm db:migrate:remote
```

3. Set production secrets from the same `.env` file, in one shot (do **not** commit
   `.env` — applies additively, safe to re-run, never deletes existing secrets):

```bash
pnpm exec wrangler deploy --secrets-file=.env
```

Or set them one at a time instead:

```bash
pnpm exec wrangler secret put MISTRAL_API_KEY
pnpm exec wrangler secret put GOOGLE_CLIENT_ID
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET
pnpm exec wrangler secret put ADMIN_EMAILS   # comma-separated list of admin emails
pnpm exec wrangler secret put TURNSTILE_SECRET_KEY
pnpm exec wrangler secret put FCM_SERVICE_ACCOUNT_JSON
```

4. Deploy (if you didn't already via `--secrets-file` above):

```bash
pnpm deploy
```

Worker URL: `https://qoyyid.23p.dev` (custom domain route, see `wrangler.jsonc`).

## Admin bootstrap

The first login from an email listed in `ADMIN_EMAILS` is automatically granted
`is_admin = 1` and bypasses the invite requirement — no manually pre-seeded `invites`
row is needed for the first admin account.
