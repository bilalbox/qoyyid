import type { Document, Env } from "./types";
import { jobKeys } from "./http";
import { putBytes, putJson } from "./r2";
import { normalizeDocument } from "./normalize";
import { documentToDocxBuffer } from "./docx-export";
import { fetchBatchResult, type MistralBatchJobStatus, type MistralBatchResultLine } from "./mistral";
import { mapMistralPageToQoyyidPage, mapMistralAudioToQoyyidPage, stripRunningHeaders } from "./mistral-mapping";
import { notifyUser } from "./fcm";

interface JobForMerge {
  id: string;
  user_id: string;
  sha256: string;
  file_key: string;
  title: string | null;
  mistral_batch_job_id: string | null;
  modality: "pdf" | "audio";
}

export interface JobForBuild {
  file_key: string;
  sha256: string;
  title: string | null;
  modality: "pdf" | "audio";
}

/**
 * Maps a stored/fetched Mistral batch result line into qoyyid's Document
 * schema and builds the matching .docx. Pure (no R2/DB writes) so both the
 * original finalizeJob path and the admin "reproduce document.json" action
 * can share it and stay in sync.
 */
export async function buildDocumentAndDocx(
  job: JobForBuild,
  jobId: string,
  resultLine: MistralBatchResultLine,
): Promise<{ doc: Document; docx: Uint8Array; unitsProcessed: number }> {
  let pages: any[] = [];
  let unitsProcessed = 0;

  if (job.modality === "audio") {
    const text = resultLine.response?.body?.text;
    if (!text) {
      throw new Error(`no audio transcript for job ${jobId} in batch output`);
    }
    const mapped = mapMistralAudioToQoyyidPage(text);
    pages = [mapped.page];
    // asr_minutes usage is billed on wall-clock audio duration, from Mistral's
    // own usage.prompt_audio_seconds — never trust client-supplied duration.
    // Round up to the nearest minute, minimum 1, matching per-minute billing.
    const seconds = resultLine.response?.body?.usage?.prompt_audio_seconds;
    unitsProcessed = seconds ? Math.max(1, Math.ceil(seconds / 60)) : 1;
  } else {
    const mistralPages = resultLine.response?.body?.pages;
    if (!mistralPages || mistralPages.length === 0) {
      throw new Error(`no OCR result for job ${jobId} in batch output`);
    }

    const mapped = mistralPages.map(mapMistralPageToQoyyidPage);
    stripRunningHeaders(mapped);
    pages = mapped.map((m) => m.page);
    unitsProcessed = pages.length;
  }

  const doc: Document = {
    source: { input: job.file_key, sha256: job.sha256, modality: job.modality },
    metadata: {
      title: job.title,
      page_count: pages.length,
      languages: ["ar"],
      engines_used: job.modality === "audio" ? ["voxtral-mini-latest", "cloud-orchestrator"] : ["mistral-ocr-latest", "cloud-orchestrator"],
    },
    pages,
  };

  normalizeDocument(doc);
  const docx = await documentToDocxBuffer(doc);
  return { doc, docx, unitsProcessed };
}

/**
 * Fetches the completed Mistral batch result, maps it to qoyyid's Document
 * schema, builds the .docx, stores both in R2, and logs quota usage from
 * Mistral's own reported page count (never from client input — see plan §5
 * "quota enforcement invariant").
 */
export async function finalizeJob(env: Env, jobId: string, batchStatus: MistralBatchJobStatus): Promise<void> {
  // Idempotency guard: Cloudflare Cron Triggers aren't guaranteed non-overlapping,
  // and this function does slow work (fetch + parse + docx build + R2 writes) that
  // can outlast the 5-minute cron interval. Without this, two overlapping
  // invocations racing on the same job would both reach the usage_events/quota
  // writes below and double-charge the user's quota for one document.
  const claimed = await env.DB.prepare(
    "UPDATE jobs SET status = 'merging', updated_at = datetime('now') WHERE id = ? AND status != 'merging' AND status != 'done'",
  )
    .bind(jobId)
    .run();
  if (claimed.meta.changes === 0) return;

  const row = await env.DB.prepare(
    "SELECT id, user_id, sha256, file_key, title, mistral_batch_job_id, modality FROM jobs WHERE id = ?",
  )
    .bind(jobId)
    .first<JobForMerge>();
  if (!row) return;

  // Everything past this point can fail (network, parsing, R2) — never leave the
  // job stuck in 'merging' with no path back to a pollable/terminal status.
  try {
    if (!batchStatus.output_file) {
      throw new Error(`batch job ${batchStatus.id} has no output_file`);
    }
    const results = await fetchBatchResult(env, batchStatus.output_file);
    const resultLine = results.find((r) => r.custom_id === jobId);
    if (!resultLine) {
      throw new Error(`no OCR result for job ${jobId} in batch output`);
    }

    // Persisted before mapping/docx-export run, so a bug in either of those
    // still leaves an admin something to reproduce from (see /admin/jobs) —
    // this is the sole source of truth for reprocessing, since Mistral
    // doesn't retain batch output indefinitely.
    const keys = jobKeys(jobId);
    await putJson(env.BUCKET, keys.mistralResponse, resultLine);

    const { doc, docx, unitsProcessed } = await buildDocumentAndDocx(row, jobId, resultLine);
    await putJson(env.BUCKET, keys.document, doc);
    await putBytes(env.BUCKET, keys.docx, docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

    const usageKind = row.modality === "audio" ? "asr_minutes" : "ocr_pages";
    const quotaColumn = row.modality === "audio" ? "quota_minutes_used" : "quota_pages_used";

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE jobs SET status = 'done', error = NULL, mistral_units_processed = ?, updated_at = datetime('now') WHERE id = ?`,
      ).bind(unitsProcessed, jobId),
      env.DB.prepare(
        `INSERT INTO usage_events (id, user_id, job_id, kind, quantity) SELECT lower(hex(randomblob(16))), user_id, ?, ?, ? FROM jobs WHERE id = ?`,
      ).bind(jobId, usageKind, unitsProcessed, jobId),
      env.DB.prepare(`UPDATE users SET ${quotaColumn} = ${quotaColumn} + ? WHERE id = (SELECT user_id FROM jobs WHERE id = ?)`).bind(
        unitsProcessed,
        jobId,
      ),
    ]);

    await notifyUser(env, row.user_id, {
      title: "Document ready",
      body: row.title ? `"${row.title}" finished processing.` : "Your document finished processing.",
      data: { jobId },
    });
  } catch (e) {
    await markJobFailed(env, jobId, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

export async function markJobFailed(env: Env, jobId: string, error: string): Promise<void> {
  const row = await env.DB.prepare(`UPDATE jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ? RETURNING user_id, title`)
    .bind(error, jobId)
    .first<{ user_id: string; title: string | null }>();

  if (row) {
    await notifyUser(env, row.user_id, {
      title: "Document processing failed",
      body: row.title ? `"${row.title}" failed to process.` : "A document failed to process.",
      data: { jobId },
    });
  }
}
