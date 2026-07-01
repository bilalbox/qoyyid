# 2. Exclude YouTube fetching from the Edge

Date: 2026-07-01

## Status

Accepted

## Context

We are introducing an ASR (Audio Speech Recognition) feature to process audio and output Arabic transcripts, similar to our existing OCR pipeline.
A highly desired capability was to support fetching audio tracks or pre-existing transcripts directly from a provided YouTube URL, to avoid users having to manually download and re-upload content.

However, the application backend is built on Cloudflare Workers (a Hono app running in V8 isolates). Fetching YouTube media reliably requires tools like `yt-dlp` or `ffmpeg`, which cannot be executed within the Worker isolate constraints. Additionally, fetching from the client-side JavaScript is blocked by CORS, and attempting to parse undocumented YouTube XML transcript endpoints from the edge is extremely fragile and prone to IP blocking.

## Decision

We will strictly limit the scope of the ASR feature to **audio file uploads only**, completely excluding YouTube URL support from this iteration.

## Consequences

- **Positive:** We maintain a simple, reliable, and predictable edge architecture without introducing fragile scraping logic or requiring heavy external proxy services.
- **Negative:** Users who want to transcribe YouTube videos must manually download the audio file and upload it to our platform.
