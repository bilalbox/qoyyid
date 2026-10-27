# Native app (Android + Windows via Tauri) — design notes

Captured from a design interview on 2026-07-02. See also [ADR 0003](../adr/0003-youtube-via-native-client.md) for the YouTube-specific architectural decision.

## Motivation

Two features want capabilities a browser doesn't have:

- **YouTube audio extraction** — needs to run on the user's own device/IP to avoid the datacenter-IP-blocking problem that ruled out edge/server-side fetching (see ADR 0002 and 0003).
- **PDF page manipulation** (removal, margin edits, note injection) — not designed yet; deferred to its own design session. Local filesystem access and native PDF libraries make this a better fit for a native app than the browser.

Both point at the same solution: a native companion app, not more web-app features.

## Scope for this iteration

This doc covers the **platform decision and the YouTube feature**. PDF manipulation is out of scope here — future design session.

## Web app scope: unchanged

The existing SvelteKit web app (`public/`, `src/routes/`) keeps its current full functionality — PDF OCR upload, audio upload, job status, docx download — for anyone without the native app. It does not shrink to admin-only. New features (YouTube extraction, PDF tools) are native-app-exclusive going forward; the web app simply stops growing new capability.

## Platform: Tauri, not Capacitor

Chosen over Capacitor because Windows desktop is explicit scope:

- Tauri uses the OS's native WebView (WebView2 on Windows) with no bundled Chromium — tens of MB, vs. Capacitor's desktop story being a community Electron wrapper (100MB+, bundled Chromium + Node).
- Tauri's Rust backend gives CORS-free networking (webview JS calls `invoke()` on a Rust command that does the real HTTP fetch) and first-class **sidecar** support for bundling per-platform native binaries — useful for future PDF libraries (`lopdf`, `pdfium-render`) and tools like `ffmpeg`.
- Tradeoff accepted: Tauri's Android/mobile support (stabilized in Tauri v2, 2024) is newer and thinner than Capacitor's years-battle-tested Android runtime and plugin catalog. Narrower risk here since iOS is out of scope — Android only.
- Rust is new to the team; ramp-up leans on coding agents plus the [Apollo `rust-best-practices` skill](https://www.skills.sh/apollographql/skills/rust-best-practices). Most domain logic (job orchestration, YouTube resolution via `youtubei.js`) stays in JS/TS; Rust is mostly the thin native-command layer.

## Repo structure

Same repo, sibling directory (e.g. `apps/desktop`) alongside the existing SvelteKit app, using a pnpm workspace (already on pnpm per `pnpm-lock.yaml`). Shares the `src/lib/api.ts`-derived API client and `src/types.ts` types directly via local package import — no duplication, no publishing/versioning overhead.

## Auth

System-browser OAuth + deep-link callback:

1. Tauri app opens the user's default browser (via Tauri's `shell`/`opener` plugin) to `/auth/google`.
2. Existing Hono OAuth route (`src/auth.ts`) runs unmodified.
3. Backend needs one addition: `/auth/google/callback` needs to branch (via a `state`/`client` flag carried through the OAuth flow) — when the flow originated from the native app, redirect to a custom URI scheme (e.g. `qoyyid://auth-callback?token=...`) instead of setting a cookie.
4. Tauri's deep-link plugin catches the callback, extracts the session token, stores it via Tauri secure storage.
5. All API calls from the native app send `Authorization: Bearer <token>` — already supported by `src/index.ts:29`, no further backend change needed.

## YouTube audio extraction

- `youtubei.js` bundled in the Tauri app's webview JS handles InnerTube resolution and signature deciphering (chosen over hand-rolling this logic — inherits community fixes for YouTube's frequent obfuscation changes).
- Actual HTTP fetches routed through a Tauri Rust command (`invoke`), not webview `fetch()` — this is what avoids CORS, not `youtubei.js` itself.
- **Uniform implementation** across Android and Windows — no `yt-dlp` sidecar split, despite Windows being able to support one (`yt-dlp` has no official Android build; two extraction code paths for one feature was judged not worth the doubled maintenance).
- Audio format: **itag 140 (AAC/m4a) only**, skip Opus (itag 251) entirely. Already a supported `contentType` in `src/jobs.ts:171-175` — zero backend change. Codec choice shouldn't matter for transcription quality at speech bitrates.
- **Public videos only.** No YouTube authentication/cookie handling — age-restricted/unlisted/members-only content out of scope, revisit only if a real need shows up.
- UI: **paste-URL text field first.** Android share-sheet intent integration (registering the app in the native share sheet so a shared YouTube link opens directly into extraction) is a deliberate fast-follow, not day-one — paste field covers all platforms including Windows and is far less implementation surface.
- Upload path: extracted bytes go through the **existing, unmodified** `/jobs/audio-upload` → presigned R2 PUT → `/start-audio` sequence (`src/jobs.ts:156-246`, mirrors `uploadJob()` in `src/lib/api.ts`). YouTube is just an alternate client-side byte source, not a new backend path.
- The source YouTube URL is **discarded after extraction** — not persisted as a `source_url` column or anywhere else.
- **One-time Arabic-language disclaimer** shown before first use of the paste-URL feature, framing the tool for its intended purpose: assisting teachers and students of Islamic knowledge, sound Arabic content only. Policy-only — no automated language/content enforcement (a language-ID check couldn't verify "soundness" anyway, and would false-positive on legitimate mixed-language lectures).

## Distribution

**Sideload to start**, both platforms — direct APK download (Android), direct MSI/EXE (Windows). No Play Store / Microsoft Store initially. Tauri's self-hosted updater plugin wired up on both, chosen specifically because `youtubei.js` decipher breakage is a _when, not if_ (same class of problem every YouTube-downloader tool faces) and store review queues would leave users broken for hours-to-days per incident. Store distribution can be added later once the app is stable; sideload-first avoids review entirely for now while the extraction logic is still finding its feet.

## Deferred / not yet designed

- **PDF page manipulation** (removal, margins, note injection) — separate design session.
- Extraction failure/error UX (video unavailable, decipher broken, live streams, region-locked) — implementation detail, not architecturally blocking.
- Disclaimer storage mechanics (per-user flag, where recorded, exact Arabic copy) — implementation detail.
- Android share-sheet intent integration — fast-follow after the paste-field ships.

## Related work surfaced during this design pass

While reviewing the audio-job flow, found that **`quota_minutes` enforcement was never wired up** despite the schema already supporting it (see follow-up task below) — audio jobs currently increment `quota_pages_used` instead of `quota_minutes_used`, and `quotaExceeded()` never checks minutes at all. This is a pre-existing bug independent of the YouTube feature, being fixed standalone, first, before YouTube-sourced audio ships — see git history / separate PR for the fix itself.
