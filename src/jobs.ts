import type { Env } from "./types";
import { json, jobKeys, uploadPdfKey } from "./http";
import { getJson, sha256Hex } from "./r2";
import { uploadFileToMistral, submitBatchOcrJob } from "./mistral";
import { markJobFailed } from "./merge";
import type { User } from "./users";

function newJobId(): string {
  return crypto.randomUUID();
}

function titleFromFilename(filename: string): string {
  return filename.replace(/\.pdf$/i, "").trim() || filename;
}

export async function handleCreateJob(
  request: Request,
  env: Env,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  user: User,
): Promise<Response> {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return json({ error: "expected multipart/form-data with file field" }, 400);
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return json({ error: "missing file field" }, 400);
  }

  const pdfFile = file as File;
  const bytes = await pdfFile.arrayBuffer();
  if (!bytes.byteLength) {
    return json({ error: "empty file" }, 400);
  }

  const sha256 = await sha256Hex(bytes);
  const pdfKey = uploadPdfKey(sha256);
  const existing = await env.DB.prepare(
    "SELECT id, status FROM jobs WHERE sha256 = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(sha256, user.id)
    .first<{ id: string; status: string }>();

  if (existing && existing.status !== "failed") {
    return json({ job_id: existing.id, sha256, status: existing.status, deduplicated: true }, 200);
  }

  // Quota is only checked once we know this isn't a free dedup hit — a user
  // whose quota is exhausted can still re-fetch a document they already paid for.
  if (user.quota_pages_used >= user.quota_pages_limit) {
    return json({ error: "quota exceeded", quota_pages_limit: user.quota_pages_limit }, 402);
  }

  await env.BUCKET.put(pdfKey, bytes, { httpMetadata: { contentType: "application/pdf" } });

  const jobId = newJobId();
  const title = titleFromFilename(pdfFile.name || sha256.slice(0, 12));
  await env.DB.prepare(`INSERT INTO jobs (id, user_id, sha256, pdf_key, status, title) VALUES (?, ?, ?, ?, 'uploaded', ?)`)
    .bind(jobId, user.id, sha256, pdfKey, title)
    .run();

  ctx.waitUntil(
    (async () => {
      try {
        await submitToMistral(env, jobId, bytes, pdfFile.name || "document.pdf");
      } catch (e) {
        console.error("submit to mistral failed", e);
        await markJobFailed(env, jobId, e instanceof Error ? e.message : String(e));
      }
    })(),
  );

  return json({ job_id: jobId, sha256, status: "uploaded" }, 201);
}

async function submitToMistral(env: Env, jobId: string, bytes: ArrayBuffer, filename: string): Promise<void> {
  const fileId = await uploadFileToMistral(env, bytes, filename, "ocr");
  await env.DB.prepare(
    `UPDATE jobs SET status = 'file_uploaded', mistral_file_id = ?, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(fileId, jobId)
    .run();

  const batchJobId = await submitBatchOcrJob(env, jobId, fileId);
  await env.DB.prepare(
    `UPDATE jobs SET status = 'batch_submitted', mistral_batch_job_id = ?, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(batchJobId, jobId)
    .run();
}

export async function handleListJobs(env: Env, user: User): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, sha256, status, title, total_pages, mistral_pages_processed, error, created_at, updated_at FROM jobs WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(user.id)
    .all();
  return json({ jobs: results });
}

export async function handleGetJob(env: Env, user: User, jobId: string): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT id, sha256, status, title, total_pages, mistral_pages_processed, error, created_at, updated_at FROM jobs WHERE id = ? AND user_id = ?",
  )
    .bind(jobId, user.id)
    .first();

  if (!row) return json({ error: "not found" }, 404);
  return json(row);
}

export async function handleGetDocx(env: Env, user: User, jobId: string): Promise<Response> {
  const row = await env.DB.prepare("SELECT status FROM jobs WHERE id = ? AND user_id = ?")
    .bind(jobId, user.id)
    .first<{ status: string }>();
  if (!row) return json({ error: "not found" }, 404);
  if (row.status !== "done") {
    return json({ error: "not ready", status: row.status }, 409);
  }
  const obj = await env.BUCKET.get(jobKeys(jobId).docx);
  if (!obj) return json({ error: "docx missing" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${jobId}.docx"`,
    },
  });
}

export async function handleGetDocument(env: Env, user: User, jobId: string): Promise<Response> {
  const row = await env.DB.prepare("SELECT status FROM jobs WHERE id = ? AND user_id = ?")
    .bind(jobId, user.id)
    .first<{ status: string }>();
  if (!row) return json({ error: "not found" }, 404);
  if (row.status !== "done") {
    return json({ error: "not ready", status: row.status }, 409);
  }
  const doc = await getJson(env.BUCKET, jobKeys(jobId).document);
  if (!doc) return json({ error: "document missing" }, 404);
  return json(doc);
}
