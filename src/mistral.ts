import type { Env } from "./types";
import { generatePresignedGetUrl } from "./presign";

/**
 * Worker-internal Mistral API client. MISTRAL_API_KEY is injected here and
 * never leaves the Worker — the Svelte client never talks to Mistral
 * directly (see plan §5). Not exposed as public routes.
 */

const MISTRAL_API = "https://api.mistral.ai/v1";
const OCR_MODEL = "mistral-ocr-latest";
const AUDIO_MODEL = "voxtral-mini-latest";

function authHeaders(env: Env): Record<string, string> {
  return { Authorization: `Bearer ${env.MISTRAL_API_KEY}` };
}

async function mistralJson<T>(env: Env, path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${MISTRAL_API}${path}`, {
    ...init,
    headers: { ...authHeaders(env), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Mistral API ${init.method ?? "GET"} ${path}: HTTP ${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export async function uploadFileToMistral(
  env: Env,
  bytes: ArrayBuffer,
  filename: string,
  purpose: "ocr" | "batch",
): Promise<string> {
  const form = new FormData();
  form.append("purpose", purpose);
  form.append("file", new Blob([bytes]), filename);
  const result = await mistralJson<{ id: string }>(env, "/files", { method: "POST", body: form });
  return result.id;
}

/**
 * Wraps the PDF file_id in a single-line JSONL batch input, uploads it, and
 * submits a batch OCR job referencing it. Returns the batch job id.
 *
 * Confirmed against a real batch run (2026-07-01): `{ type: "file", file_id }`
 * is the correct document reference shape for a Files-API-uploaded PDF.
 */
export async function submitBatchOcrJob(env: Env, jobId: string, pdfFileId: string): Promise<string> {
  const batchLine = {
    custom_id: jobId,
    body: {
      model: OCR_MODEL,
      document: { type: "file", file_id: pdfFileId },
    },
  };
  const jsonl = `${JSON.stringify(batchLine)}\n`;
  const jsonlFileId = await uploadFileToMistral(
    env,
    new TextEncoder().encode(jsonl).buffer as ArrayBuffer,
    `${jobId}.jsonl`,
    "batch",
  );

  const job = await mistralJson<{ id: string }>(env, "/batch/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input_files: [jsonlFileId],
      model: OCR_MODEL,
      endpoint: "/v1/ocr",
      timeout_hours: 24,
    }),
  });
  return job.id;
}


export async function submitBatchAudioJob(env: Env, jobId: string, fileKey: string): Promise<string> {
  const fileUrl = await generatePresignedGetUrl(env, fileKey);
  const batchLine = {
    custom_id: jobId,
    body: {
      model: AUDIO_MODEL,
      file_url: fileUrl,
      diarize: true,
    },
  };
  const jsonl = `${JSON.stringify(batchLine)}\n`;
  const jsonlFileId = await uploadFileToMistral(
    env,
    new TextEncoder().encode(jsonl).buffer as ArrayBuffer,
    `${jobId}.jsonl`,
    "batch",
  );

  const job = await mistralJson<{ id: string }>(env, "/batch/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input_files: [jsonlFileId],
      model: AUDIO_MODEL,
      endpoint: "/v1/audio/transcriptions",
      timeout_hours: 24,
    }),
  });
  return job.id;
}

export interface MistralBatchJobStatus {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED" | string;
  output_file?: string | null;
  error_file?: string | null;
}

export async function pollBatchStatus(env: Env, batchJobId: string): Promise<MistralBatchJobStatus> {
  return mistralJson<MistralBatchJobStatus>(env, `/batch/jobs/${batchJobId}`, { method: "GET" });
}

/**
 * A page in Mistral OCR 4's response. Confirmed against a real batch result
 * (2026-07-01): there is no `blocks`/bbox array — `header`/`footer` are
 * present in the schema but come back null in practice. All structure has to
 * be parsed out of `markdown` (see mistral-mapping.ts).
 */
export interface MistralOcrPage {
  index: number;
  markdown: string;
  dimensions?: { width: number; height: number; dpi?: number };
}

export interface MistralBatchResultLine {
  custom_id: string;
  response?: {
    body?: {
      pages?: MistralOcrPage[];
      text?: string;
      // Per Mistral's documented /v1/audio/transcriptions response schema
      // (https://docs.mistral.ai/api/endpoint/audio/transcriptions) — not yet
      // confirmed against a real completed batch job the way the OCR fields
      // above are. Verify this shape survives once a real audio batch finishes.
      usage?: { prompt_audio_seconds?: number };
    };
  };
  error?: unknown;
}
/**
 * Downloads and parses the batch output JSONL. Confirmed against a real
 * completed batch job (2026-07-01): the endpoint path below is correct.
 */
export async function fetchBatchResult(env: Env, outputFileId: string): Promise<MistralBatchResultLine[]> {
  const res = await fetch(`${MISTRAL_API}/files/${outputFileId}/content`, {
    headers: authHeaders(env),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Mistral API GET /files/${outputFileId}/content: HTTP ${res.status}: ${detail}`);
  }
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as MistralBatchResultLine);
}
