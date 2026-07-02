# 3. YouTube audio extraction via native client, not the edge

Date: 2026-07-02

## Status

Accepted

## Context

[ADR 0002](./0002-exclude-youtube-from-edge.md) excluded YouTube URL fetching from the Cloudflare Workers backend: Worker isolates can't run `yt-dlp`/`ffmpeg`, browser-side `fetch` is blocked by CORS, and server-side fetching from datacenter IPs is fragile and gets blocked by YouTube regardless. That reasoning still holds for the edge — nothing here reopens it.

Separately, we're now building a native companion app (Android + Windows, via Tauri) so users can get local-filesystem-dependent PDF tools (page removal, margin edits, note injection) that a browser can't provide. That app changes what's feasible for YouTube specifically: extraction can run entirely on the user's own device, using their own residential IP and their own local process — the exact capability a server-side fetch never had, and the reason cobalt/yt-dlp-style tools work at all once you're off datacenter IPs.

## Decision

YouTube audio extraction ships as a **native-app-exclusive** feature (Tauri app, not the browser web app), not as a backend capability:

- `youtubei.js` runs in the Tauri app's webview JS to resolve InnerTube metadata and decipher signature-obfuscated stream URLs.
- The actual HTTP fetch of the resolved stream is routed through a Tauri Rust command (`invoke`) rather than the webview's `fetch()`, which is what avoids CORS — a plain web page could not do this even with `youtubei.js` bundled.
- One implementation path on both Android and Windows (no `yt-dlp` sidecar split), since `yt-dlp` has no official Android build and two extraction implementations doubles the maintenance surface for a single-feature.
- Audio is requested as itag 140 (AAC/m4a) specifically — already a supported `contentType` in the existing audio-upload flow (`src/jobs.ts:171-175`), so no backend changes are needed to accept it.
- Public videos only. No YouTube authentication/cookie handling.
- Extracted bytes are pushed through the existing `/jobs/audio-upload` → presigned R2 PUT → `/start-audio` sequence unmodified (`src/jobs.ts:156-246`) — YouTube is just an alternate client-side source of audio bytes, not a new backend path.
- The source YouTube URL is discarded after extraction; not persisted anywhere.
- A one-time Arabic-language disclaimer is shown before first use, framing the feature for its intended purpose (assisting teachers and students of Islamic knowledge; sound Arabic content only). This is policy, not a technical content/language gate.

## Consequences

- **Positive:** resolves the negative consequence ADR 0002 accepted (users manually downloading and re-uploading) without reopening ADR 0002's edge-simplicity reasoning — the Worker still does zero YouTube fetching.
- **Positive:** reuses the existing audio-job backend path entirely; zero new API surface.
- **Negative:** introduces a maintenance surface the edge never had — `youtubei.js`'s decipher logic can break when YouTube rotates obfuscation, same class of problem every YouTube-downloader tool faces. Mitigated by sideloaded distribution (direct APK/MSI, no app stores initially) plus Tauri's self-hosted updater, so fixes ship without app-store review latency.
- **Negative:** the feature is native-app-exclusive — browser-only users don't get it. The web app keeps its current full functionality (PDF OCR, audio upload) but new features going forward live in the native app.
- **Negative, accepted:** extracting YouTube audio runs against YouTube's ToS. Accepted because extraction happens entirely on the user's own device/IP, closer to personal use than a hosted download service, and usage is scoped by the disclaimer to a small, known audience of teachers/students rather than the general public.
