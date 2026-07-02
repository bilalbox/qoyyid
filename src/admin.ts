import { Hono } from "hono";
import type { Document, Env } from "./types";
import type { Session, User } from "./users";
import { json, jobKeys } from "./http";
import { exists, getJson, putBytes, putJson } from "./r2";
import { buildDocumentAndDocx, type JobForBuild } from "./merge";
import { documentToDocxBuffer } from "./docx-export";
import type { MistralBatchResultLine } from "./mistral";

type Variables = { user: User; session: Session };

export const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

interface UserRow {
  id: string;
  email: string;
  is_admin: number;
  quota_pages_limit: number;
  quota_pages_used: number;
  quota_minutes_limit: number;
  quota_minutes_used: number;
  created_at: string;
  job_count: number;
}

admin.get("/admin/api/users", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.is_admin, u.quota_pages_limit, u.quota_pages_used,
            u.quota_minutes_limit, u.quota_minutes_used, u.created_at,
            (SELECT COUNT(*) FROM jobs WHERE jobs.user_id = u.id) as job_count
     FROM users u ORDER BY u.created_at DESC`,
  ).all<UserRow>();

  return json({
    users: results.map((u) => ({ ...u, is_admin: Boolean(u.is_admin) })),
  });
});

admin.post("/admin/api/users/:id/quota", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ quota_pages_limit?: number }>().catch(() => ({}) as { quota_pages_limit?: number });
  const quota_pages_limit = body.quota_pages_limit;
  if (!Number.isFinite(quota_pages_limit) || (quota_pages_limit as number) < 0) {
    return json({ error: "invalid quota" }, 400);
  }
  await c.env.DB.prepare("UPDATE users SET quota_pages_limit = ? WHERE id = ?")
    .bind(quota_pages_limit, id)
    .run();
  return json({ success: true });
});

interface InviteRow {
  email: string;
  created_at: string;
  used_at: string | null;
}

admin.get("/admin/api/invites", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT email, created_at, used_at FROM invites ORDER BY created_at DESC",
  ).all<InviteRow>();
  return json({ invites: results });
});

admin.post("/admin/api/invites", async (c) => {
  const body = await c.req.json<{ email?: string }>().catch(() => ({}) as { email?: string });
  const email = String(body.email || "").trim().toLowerCase();
  if (!email) return json({ error: "email required" }, 400);
  await c.env.DB.prepare("INSERT OR IGNORE INTO invites (email) VALUES (?)").bind(email).run();
  return json({ success: true });
});

interface JobListRow {
  id: string;
  user_email: string;
  title: string | null;
  status: string;
  error: string | null;
  file_key: string;
  created_at: string;
}

const JOB_LIST_LIMIT = 200;

admin.get("/admin/api/jobs", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT jobs.id, users.email as user_email, jobs.title, jobs.status, jobs.error,
            jobs.file_key, jobs.created_at
     FROM jobs JOIN users ON users.id = jobs.user_id
     ORDER BY jobs.created_at DESC
     LIMIT ?`,
  )
    .bind(JOB_LIST_LIMIT)
    .all<JobListRow>();

  const jobs = await Promise.all(
    results.map(async (job) => {
      const keys = jobKeys(job.id);
      const [hasPdf, hasResponse, hasDocument, hasDocx] = await Promise.all([
        exists(c.env.BUCKET, job.file_key),
        exists(c.env.BUCKET, keys.mistralResponse),
        exists(c.env.BUCKET, keys.document),
        exists(c.env.BUCKET, keys.docx),
      ]);
      return {
        id: job.id,
        title: job.title,
        user_email: job.user_email,
        status: job.status,
        error: job.error,
        created_at: job.created_at,
        available: { pdf: hasPdf, response: hasResponse, document: hasDocument, docx: hasDocx },
      };
    }),
  );

  return json({ jobs });
});

async function requireJobRow(c: { env: Env }, jobId: string): Promise<(JobForBuild & { id: string; user_id: string }) | null> {
  return c.env.DB.prepare("SELECT id, user_id, sha256, file_key, title, modality FROM jobs WHERE id = ?")
    .bind(jobId)
    .first<JobForBuild & { id: string; user_id: string }>();
}

function download(obj: R2ObjectBody | null, contentType: string, filename: string): Response {
  if (!obj) return new Response("not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

admin.get("/admin/jobs/:id/pdf", async (c) => {
  const jobId = c.req.param("id");
  const row = await requireJobRow(c, jobId);
  if (!row) return c.text("job not found", 404);
  const extension = row.file_key.split(".").pop() || "bin";
  const contentType = row.modality === "audio" ? "application/octet-stream" : "application/pdf";
  return download(await c.env.BUCKET.get(row.file_key), contentType, `${jobId}.${extension}`);
});

admin.get("/admin/jobs/:id/mistral-response", async (c) => {
  const jobId = c.req.param("id");
  return download(
    await c.env.BUCKET.get(jobKeys(jobId).mistralResponse),
    "application/json; charset=utf-8",
    `${jobId}-mistral-response.json`,
  );
});

admin.get("/admin/jobs/:id/document", async (c) => {
  const jobId = c.req.param("id");
  return download(
    await c.env.BUCKET.get(jobKeys(jobId).document),
    "application/json; charset=utf-8",
    `${jobId}-document.json`,
  );
});

admin.get("/admin/jobs/:id/docx", async (c) => {
  const jobId = c.req.param("id");
  return download(
    await c.env.BUCKET.get(jobKeys(jobId).docx),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    `${jobId}.docx`,
  );
});

/**
 * Re-runs mapping + docx-export from the job's permanently-stored Mistral
 * response (never re-contacts Mistral), overwrites document.json/output.docx
 * in place, and can flip a job that failed at the mapping/docx stage back to
 * 'done'. Quota is only charged if this job never had a usage_events row —
 * a job already 'done' being reproduced isn't charged again.
 */
admin.post("/admin/api/jobs/:id/reproduce-document", async (c) => {
  const jobId = c.req.param("id");
  const row = await requireJobRow(c, jobId);
  if (!row) return json({ error: "job not found" }, 404);

  const keys = jobKeys(jobId);
  const resultLine = await getJson<MistralBatchResultLine>(c.env.BUCKET, keys.mistralResponse);
  if (!resultLine) return json({ error: "no stored Mistral response for this job — cannot reproduce" }, 409);

  let build: Awaited<ReturnType<typeof buildDocumentAndDocx>>;
  try {
    build = await buildDocumentAndDocx(row, jobId, resultLine);
  } catch (e) {
    return json({ error: `reproduce failed: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }

  await putJson(c.env.BUCKET, keys.document, build.doc);
  await putBytes(
    c.env.BUCKET,
    keys.docx,
    build.docx,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );

  const usageKind = row.modality === "audio" ? "asr_minutes" : "ocr_pages";
  const alreadyCharged = await c.env.DB.prepare(
    "SELECT 1 FROM usage_events WHERE job_id = ? AND kind = ?",
  )
    .bind(jobId, usageKind)
    .first();

  const statements = [
    c.env.DB.prepare(
      `UPDATE jobs SET status = 'done', error = NULL, mistral_units_processed = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(build.unitsProcessed, jobId),
  ];
  if (!alreadyCharged) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO usage_events (id, user_id, job_id, kind, quantity) SELECT lower(hex(randomblob(16))), user_id, ?, ?, ? FROM jobs WHERE id = ?`,
      ).bind(jobId, usageKind, build.unitsProcessed, jobId),
      row.modality === "audio"
        ? c.env.DB.prepare(
            `UPDATE users SET quota_minutes_used = quota_minutes_used + ? WHERE id = (SELECT user_id FROM jobs WHERE id = ?)`,
          ).bind(build.unitsProcessed, jobId)
        : c.env.DB.prepare(
            `UPDATE users SET quota_pages_used = quota_pages_used + ? WHERE id = (SELECT user_id FROM jobs WHERE id = ?)`,
          ).bind(build.unitsProcessed, jobId),
    );
  }
  await c.env.DB.batch(statements as Parameters<typeof c.env.DB.batch>[0]);

  return json({ success: true });
});

/**
 * Re-runs only documentToDocxBuffer against the job's current stored
 * document.json — cheap, and works even for jobs whose Mistral response
 * wasn't captured (pre-dating this feature), as long as document.json exists.
 */
admin.post("/admin/api/jobs/:id/reproduce-docx", async (c) => {
  const jobId = c.req.param("id");
  const keys = jobKeys(jobId);
  const doc = await getJson<Document>(c.env.BUCKET, keys.document);
  if (!doc) return json({ error: "no stored document.json for this job — cannot reproduce docx" }, 409);

  const docx = await documentToDocxBuffer(doc);
  await putBytes(
    c.env.BUCKET,
    keys.docx,
    docx,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );

  return json({ success: true });
});
