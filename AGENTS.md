# Qoyyid (قيد) — agent instructions

## Definition of Done (Mandatory Gate)

Before considering any code change or task done (even when not pushing), **always run `pnpm gate:fast` first**.

Do not declare completion with only piecemeal checks (`biome`, bare `tsc --noEmit`, or a single lint script). `pnpm gate:fast` bundles:

1. `biome check` (format + lint)
2. `lint:graph` (`rev-dep` — cycles, orphans, unused exports/deps, duplicates)
3. `lint:complexity` (Biome cognitive-complexity shrink-only ratchet)
4. `typecheck` (`tsc -b`)

`pnpm gate` = `pnpm gate:fast && pnpm test` (CI and pre-push).

A task is not complete until `pnpm gate:fast` passes cleanly.

## Architecture

- Orchestrator Worker: `src/index.ts` (Cloudflare Worker running Hono, handling auth, jobs, cron polling, admin, and static asset serving).
- Client SPA: `src/routes/` and `src/lib/` (SvelteKit + Skeleton + Tailwind, built into `public/`).
- Pipeline & Export: `src/mistral.ts`, `src/mistral-mapping.ts`, `src/normalize.ts`, `src/docx-export.ts`.
- Storage & DB: Cloudflare D1 (`qoyyid-jobs`) + R2 (`qoyyid-assets`).
