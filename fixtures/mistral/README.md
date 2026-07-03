# Mistral API response fixtures

Captured from real sync API calls on 2026-07-03 to pin the response shapes the
Worker relies on (see the "Confirmed against" comments in `src/mistral.ts`).

- `ocr-blocks-page.json` — `/v1/ocr` with `include_blocks`, `extract_header`,
  `extract_footer`, `table_format: "markdown"` on a scanned muhaqqaq sharh
  page (`OLD_qoyyid/fixtures/pages/wpage_50.png`). Shows typed blocks with
  pixel bboxes (`text`, `references`, `header`), header text removed from
  `markdown` into the `header` field, and consecutive footnote entries
  concatenated inside one `references` block.
- `audio-segments.json` — `/v1/audio/transcriptions` with `diarize` +
  `timestamp_granularities=segment` on a short Arabic clip. Shows the
  `segments[] { text, start, end, speaker_id, type }` shape and
  `usage.prompt_audio_seconds`.
