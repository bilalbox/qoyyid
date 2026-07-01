import type { Document, Env } from "./types";
import { jobKeys } from "./http";
import { putBytes, putJson } from "./r2";
import { normalizeDocument } from "./normalize";
import { documentToDocxBuffer } from "./docx-export";
import { fetchBatchResult, type MistralBatchJobStatus } from "./mistral";
import { mapMistralPageToQoyyidPage, stripRunningHeaders } from "./mistral-mapping";

interface JobForMerge {
  id: string;
  sha256: string;
  pdf_key: string;
  title: string | null;
  mistral_batch_job_id: string | null;
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
    "SELECT id, sha256, pdf_key, title, mistral_batch_job_id FROM jobs WHERE id = ?",
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
    const mistralPages = resultLine?.response?.body?.pages;
    if (!mistralPages || mistralPages.length === 0) {
      throw new Error(`no OCR result for job ${jobId} in batch output`);
    }

    const mapped = mistralPages.map(mapMistralPageToQoyyidPage);
    stripRunningHeaders(mapped);
    const pages = mapped.map((m) => m.page);

    const doc: Document = {
      source: { input: row.pdf_key, sha256: row.sha256, modality: "pdf" },
      metadata: {
        title: row.title,
        page_count: pages.length,
        languages: ["ar"],
        engines_used: ["mistral-ocr-latest", "cloud-orchestrator"],
      },
      pages,
    };

    normalizeDocument(doc);
    const keys = jobKeys(jobId);
    await putJson(env.BUCKET, keys.document, doc);

    const docx = await documentToDocxBuffer(doc);
    await putBytes(env.BUCKET, keys.docx, docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

    const pagesProcessed = pages.length;

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE jobs SET status = 'done', error = NULL, mistral_pages_processed = ?, updated_at = datetime('now') WHERE id = ?`,
      ).bind(pagesProcessed, jobId),
      env.DB.prepare(
        `INSERT INTO usage_events (id, user_id, job_id, kind, quantity) SELECT lower(hex(randomblob(16))), user_id, ?, 'ocr_pages', ? FROM jobs WHERE id = ?`,
      ).bind(jobId, pagesProcessed, jobId),
      env.DB.prepare(`UPDATE users SET quota_pages_used = quota_pages_used + ? WHERE id = (SELECT user_id FROM jobs WHERE id = ?)`).bind(
        pagesProcessed,
        jobId,
      ),
    ]);
  } catch (e) {
    await markJobFailed(env, jobId, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

export async function markJobFailed(env: Env, jobId: string, error: string): Promise<void> {
  await env.DB.prepare(`UPDATE jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(error, jobId)
    .run();
}
