import type { Env } from "./types";
import { json, jobKeys, uploadFileKey } from "./http";
import { exists, getJson, sha256Hex } from "./r2";
import { uploadFileToMistral, submitBatchOcrJob, submitBatchAudioJob } from "./mistral";
import { markJobFailed } from "./merge";
import type { User } from "./users";
import { generatePresignedPutUrl } from "./presign";

function newJobId(): string {
  return crypto.randomUUID();
}

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").trim() || filename;
}

async function findExistingJob(env: Env, sha256: string, userId: string): Promise<{ id: string; status: string } | null> {
  return env.DB.prepare(
    "SELECT id, status FROM jobs WHERE sha256 = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(sha256, userId)
    .first<{ id: string; status: string }>();
}

// Quota is only checked once we know this isn't a free dedup hit — a user
// whose quota is exhausted can still re-fetch a document they already paid for.
function quotaExceeded(user: User): boolean {
  return user.quota_pages_used >= user.quota_pages_limit;
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

  const fileField = file as File;
  const bytes = await fileField.arrayBuffer();
  if (!bytes.byteLength) {
    return json({ error: "empty file" }, 400);
  }

  const sha256 = await sha256Hex(bytes);
  const fileKey = uploadFileKey(sha256);
  const existing = await findExistingJob(env, sha256, user.id);

  if (existing && existing.status !== "failed") {
    return json({ job_id: existing.id, sha256, status: existing.status, deduplicated: true }, 200);
  }

  if (quotaExceeded(user)) {
    return json({ error: "quota exceeded", quota_pages_limit: user.quota_pages_limit }, 402);
  }

  await env.BUCKET.put(fileKey, bytes, { httpMetadata: { contentType: "application/pdf" } });

  const jobId = newJobId();
  const title = titleFromFilename(fileField.name || sha256.slice(0, 12));
  await env.DB.prepare(`INSERT INTO jobs (id, user_id, sha256, file_key, status, title, modality, source_units) VALUES (?, ?, ?, ?, 'uploaded', ?, 'pdf', 0)`)
    .bind(jobId, user.id, sha256, fileKey, title)
    .run();

  ctx.waitUntil(
    (async () => {
      try {
        await submitToMistral(env, jobId, bytes, fileField.name || "document.pdf");
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
    "SELECT id, sha256, status, title, source_units, mistral_units_processed, error, created_at, updated_at FROM jobs WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(user.id)
    .all();
  return json({ jobs: results });
}

export async function handleGetJob(env: Env, user: User, jobId: string): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT id, sha256, status, title, source_units, mistral_units_processed, error, created_at, updated_at FROM jobs WHERE id = ? AND user_id = ?",
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


export async function handleCreateAudioUpload(
  request: Request,
  env: Env,
  user: User,
): Promise<Response> {
  const body = await request
    .json<{ sha256?: string; filename?: string; contentType?: string }>()
    .catch(() => ({}) as { sha256?: string; filename?: string; contentType?: string });
  const { sha256, filename, contentType } = body;

  if (!sha256 || !filename || !contentType) {
    return json({ error: "missing sha256, filename, or contentType" }, 400);
  }

  const extensionByContentType: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-m4a": "m4a",
    "audio/mp4": "m4a",
    "audio/flac": "flac",
  };
  const extension = extensionByContentType[contentType];
  if (!extension) {
    return json({ error: `unsupported content type: ${contentType}` }, 400);
  }

  const fileKey = uploadFileKey(sha256, extension);
  const existing = await findExistingJob(env, sha256, user.id);

  if (existing && existing.status !== "failed") {
    return json({ job_id: existing.id, sha256, status: existing.status, deduplicated: true }, 200);
  }

  if (quotaExceeded(user)) {
    return json({ error: "quota exceeded", quota_pages_limit: user.quota_pages_limit }, 402);
  }

  const jobId = newJobId();
  const title = titleFromFilename(filename);
  await env.DB.prepare(`INSERT INTO jobs (id, user_id, sha256, file_key, status, title, modality, source_units) VALUES (?, ?, ?, ?, 'uploading', ?, 'audio', 0)`)
    .bind(jobId, user.id, sha256, fileKey, title)
    .run();

  const uploadUrl = await generatePresignedPutUrl(env, fileKey, contentType);
  return json({ job_id: jobId, sha256, uploadUrl, status: "uploading" }, 201);
}

export async function handleStartAudioJob(
  env: Env,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  user: User,
  jobId: string,
): Promise<Response> {
  const job = await env.DB.prepare("SELECT id, status, file_key FROM jobs WHERE id = ? AND user_id = ? AND modality = 'audio'")
    .bind(jobId, user.id)
    .first<{ id: string; status: string; file_key: string }>();

  if (!job) return json({ error: "job not found" }, 404);
  if (job.status !== "uploading") return json({ error: `invalid status: ${job.status}` }, 400);

  if (!(await exists(env.BUCKET, job.file_key))) {
    return json({ error: "upload not found — PUT to the presigned URL before starting the job" }, 409);
  }

  // Mark as uploaded and start processing
  await env.DB.prepare("UPDATE jobs SET status = 'uploaded' WHERE id = ?").bind(jobId).run();

  // Audio batches reference the uploaded file via a presigned GET URL embedded
  // in the batch JSONL, rather than uploading the file bytes to Mistral first.
  ctx.waitUntil(
    (async () => {
      try {
        await submitAudioToMistral(env, jobId, job.file_key);
      } catch (e) {
        console.error("submit to mistral failed", e);
        await markJobFailed(env, jobId, e instanceof Error ? e.message : String(e));
      }
    })()
  );

  return json({ success: true, status: "uploaded" });
}

async function submitAudioToMistral(env: Env, jobId: string, fileKey: string): Promise<void> {
  const batchJobId = await submitBatchAudioJob(env, jobId, fileKey);
  await env.DB.prepare(
    `UPDATE jobs SET status = 'batch_submitted', mistral_batch_job_id = ?, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(batchJobId, jobId)
    .run();
}
