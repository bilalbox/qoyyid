# قيّد (Qoyyid)

Cloud OCR pipeline for classical Arabic manuscripts. Upload a PDF (or audio); Mistral’s batch OCR runs; the result is mapped into Qoyyid’s Document schema and exported as `.docx`. The UI is Arabic/RTL only.

Domain language (Job, Document, Reproduce, …): [CONTEXT.md](CONTEXT.md). Deploy details: [DEPLOY.md](DEPLOY.md).

## Local dev

```bash
pnpm install
cp .env.example .env   # Mistral, Google OAuth, Turnstile, FCM, VITE_* …
pnpm db:migrate:local
pnpm dev               # http://localhost:8787
```

Register `http://localhost:8787/auth/google/callback` on the Google OAuth client. Mistral has no sandbox — local runs hit the real API.

Secrets stay in `.env` / `wrangler secret` — never in `wrangler.jsonc` `vars`.

## Deploy

```bash
pnpm db:migrate:remote
pnpm exec wrangler deploy --secrets-file=.env   # or secret put each name
pnpm deploy                                     # vite build + wrangler deploy
```

Production: `https://qoyyid.23p.dev`. First login from an email in `ADMIN_EMAILS` becomes admin.

## License

MIT — see [LICENSE](LICENSE).
