# Qoyyid

Cloud OCR pipeline for classical Arabic manuscripts: PDFs go to Mistral's batch OCR API, the response is mapped into qoyyid's own Document schema, and a formatted .docx comes out the other end.

## Language

**Job**:
One user-submitted PDF moving through the pipeline (upload → Mistral batch submit/poll → merge → done/failed). Rows in the `jobs` table; artifacts live in R2 under `jobs/<id>/`.

**Mistral response** (aka raw response):
The single JSONL result line Mistral's batch API returns for one job's `custom_id` — `{ custom_id, response: { body: { pages } }, error }`, completely unprocessed. Stored verbatim at `jobs/<id>/mistral_response.json`, immediately after fetch and before mapping runs, so it survives even if mapping/docx-export subsequently throws. This is the only artifact that lets a job be reprocessed without re-submitting the PDF to Mistral (Mistral doesn't retain batch output indefinitely).
_Avoid_: raw OCR output, batch result (ambiguous between the single line and the full JSONL file)

**Document**:
Qoyyid's own schema (`src/types.ts`) — pages of typed blocks (heading/body/footnote/etc.) — produced by mapping a Mistral response through `mapMistralPageToQoyyidPage` + `normalizeDocument`. Stored at `jobs/<id>/document.json`. Mirrors `qoyyid/core/document.py`.

**Reproduce**:
Re-running a deterministic processing step against an already-stored artifact, without contacting Mistral again. Two independent actions: **reproduce document.json** (re-map from the stored Mistral response, then cascade into a docx rebuild) and **reproduce docx** (re-run only `documentToDocxBuffer` against the current stored document.json). Always overwrites the existing artifact in place — the Mistral response is the permanent source of truth, so nothing is lost by overwriting; see [ADR 0001](./docs/adr/0001-reproduce-overwrites-in-place.md).
_Avoid_: reprocess, regenerate, retry (retry implies re-contacting Mistral, which this never does)
