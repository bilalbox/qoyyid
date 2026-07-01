import { Hono } from "hono";
import type { Document, Env } from "./types";
import type { Session, User } from "./users";
import { jobKeys } from "./http";
import { exists, getJson, putBytes, putJson } from "./r2";
import { buildDocumentAndDocx, type JobForBuild } from "./merge";
import { documentToDocxBuffer } from "./docx-export";
import type { MistralBatchResultLine } from "./mistral";

type Variables = { user: User; session: Session };

export const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function page(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.4rem .6rem;text-align:left}
form{display:inline}input{padding:.3rem}button{padding:.3rem .8rem}</style></head>
<body><h1>${escapeHtml(title)}</h1><nav><a href="/admin/users">Users</a> | <a href="/admin/invites">Invites</a> | <a href="/admin/jobs">Jobs</a></nav>
${body}</body></html>`;
}

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

admin.get("/admin/users", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.is_admin, u.quota_pages_limit, u.quota_pages_used,
            u.quota_minutes_limit, u.quota_minutes_used, u.created_at,
            (SELECT COUNT(*) FROM jobs WHERE jobs.user_id = u.id) as job_count
     FROM users u ORDER BY u.created_at DESC`,
  ).all<UserRow>();

  const rows = results
    .map(
      (u) => `<tr>
    <td>${escapeHtml(u.email)}</td>
    <td>${u.is_admin ? "yes" : ""}</td>
    <td>${u.quota_pages_used}/${u.quota_pages_limit} pages, ${u.quota_minutes_used}/${u.quota_minutes_limit} min</td>
    <td>${u.job_count}</td>
    <td>${escapeHtml(u.created_at)}</td>
    <td><form method="post" action="/admin/users/${u.id}/quota">
      <input type="number" name="quota_pages_limit" value="${u.quota_pages_limit}" style="width:5em">
      <button type="submit">Set page quota</button>
    </form></td>
  </tr>`,
    )
    .join("\n");

  return c.html(
    page(
      "Users",
      `<table><tr><th>Email</th><th>Admin</th><th>Quota</th><th>Jobs</th><th>Joined</th><th>Actions</th></tr>${rows}</table>`,
    ),
  );
});

admin.post("/admin/users/:id/quota", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.formData();
  const limit = Number(form.get("quota_pages_limit"));
  if (!Number.isFinite(limit) || limit < 0) {
    return c.text("invalid quota", 400);
  }
  await c.env.DB.prepare("UPDATE users SET quota_pages_limit = ? WHERE id = ?").bind(limit, id).run();
  return c.redirect("/admin/users");
});

interface InviteRow {
  email: string;
  created_at: string;
  used_at: string | null;
}

admin.get("/admin/invites", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT email, created_at, used_at FROM invites ORDER BY created_at DESC").all<InviteRow>();
  const rows = results
    .map((i) => `<tr><td>${escapeHtml(i.email)}</td><td>${escapeHtml(i.created_at)}</td><td>${i.used_at ? "used" : "pending"}</td></tr>`)
    .join("\n");

  return c.html(
    page(
      "Invites",
      `<form method="post" action="/admin/invites">
        <input type="email" name="email" placeholder="email@example.com" required>
        <button type="submit">Create invite</button>
      </form>
      <table><tr><th>Email</th><th>Created</th><th>Status</th></tr>${rows}</table>`,
    ),
  );
});

admin.post("/admin/invites", async (c) => {
  const form = await c.req.formData();
  const email = String(form.get("email") || "").trim().toLowerCase();
  if (!email) return c.text("email required", 400);
  await c.env.DB.prepare("INSERT OR IGNORE INTO invites (email) VALUES (?)").bind(email).run();
  return c.redirect("/admin/invites");
});

interface JobListRow {
  id: string;
  user_email: string;
  title: string | null;
  status: string;
  error: string | null;
  pdf_key: string;
  created_at: string;
}

const JOB_LIST_LIMIT = 200;

admin.get("/admin/jobs", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT jobs.id, users.email as user_email, jobs.title, jobs.status, jobs.error,
            jobs.pdf_key, jobs.created_at
     FROM jobs JOIN users ON users.id = jobs.user_id
     ORDER BY jobs.created_at DESC
     LIMIT ?`,
  )
    .bind(JOB_LIST_LIMIT)
    .all<JobListRow>();

  const rows = await Promise.all(
    results.map(async (job) => {
      const keys = jobKeys(job.id);
      const [hasPdf, hasResponse, hasDocument, hasDocx] = await Promise.all([
        exists(c.env.BUCKET, job.pdf_key),
        exists(c.env.BUCKET, keys.mistralResponse),
        exists(c.env.BUCKET, keys.document),
        exists(c.env.BUCKET, keys.docx),
      ]);

      const link = (available: boolean, href: string, label: string) =>
        available ? `<a href="${href}">${label}</a>` : `<span class="text-muted">${label}</span>`;

      const downloads = [
        link(hasPdf, `/admin/jobs/${job.id}/pdf`, "pdf"),
        link(hasResponse, `/admin/jobs/${job.id}/mistral-response`, "response"),
        link(hasDocument, `/admin/jobs/${job.id}/document`, "document.json"),
        link(hasDocx, `/admin/jobs/${job.id}/docx`, "docx"),
      ].join(" · ");

      const reproduceDocument = hasResponse
        ? `<form method="post" action="/admin/jobs/${job.id}/reproduce-document"><button type="submit">Reproduce document.json</button></form>`
        : `<button type="button" disabled title="no stored Mistral response for this job">Reproduce document.json</button>`;
      const reproduceDocx = hasDocument
        ? `<form method="post" action="/admin/jobs/${job.id}/reproduce-docx"><button type="submit">Reproduce docx</button></form>`
        : `<button type="button" disabled title="no stored document.json for this job">Reproduce docx</button>`;

      return `<tr>
    <td>${escapeHtml(job.title ?? job.id.slice(0, 8))}</td>
    <td>${escapeHtml(job.user_email)}</td>
    <td>${escapeHtml(job.status)}${job.error ? ` <span class="text-muted" title="${escapeHtml(job.error)}">(error)</span>` : ""}</td>
    <td>${escapeHtml(job.created_at)}</td>
    <td>${downloads}</td>
    <td>${reproduceDocument} ${reproduceDocx}</td>
  </tr>`;
    }),
  );

  return c.html(
    page(
      "Jobs",
      `<style>.text-muted{color:#999}</style>
      <table><tr><th>Title</th><th>User</th><th>Status</th><th>Created</th><th>Downloads</th><th>Actions</th></tr>${rows.join("\n")}</table>`,
    ),
  );
});

async function requireJobRow(c: { env: Env }, jobId: string): Promise<(JobForBuild & { id: string; user_id: string }) | null> {
  return c.env.DB.prepare("SELECT id, user_id, sha256, pdf_key, title FROM jobs WHERE id = ?")
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
  return download(await c.env.BUCKET.get(row.pdf_key), "application/pdf", `${jobId}.pdf`);
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
admin.post("/admin/jobs/:id/reproduce-document", async (c) => {
  const jobId = c.req.param("id");
  const row = await requireJobRow(c, jobId);
  if (!row) return c.text("job not found", 404);

  const keys = jobKeys(jobId);
  const resultLine = await getJson<MistralBatchResultLine>(c.env.BUCKET, keys.mistralResponse);
  if (!resultLine) return c.text("no stored Mistral response for this job — cannot reproduce", 409);

  let build: Awaited<ReturnType<typeof buildDocumentAndDocx>>;
  try {
    build = await buildDocumentAndDocx(row, jobId, resultLine);
  } catch (e) {
    return c.text(`reproduce failed: ${e instanceof Error ? e.message : String(e)}`, 500);
  }

  await putJson(c.env.BUCKET, keys.document, build.doc);
  await putBytes(
    c.env.BUCKET,
    keys.docx,
    build.docx,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );

  const alreadyCharged = await c.env.DB.prepare(
    "SELECT 1 FROM usage_events WHERE job_id = ? AND kind = 'ocr_pages'",
  )
    .bind(jobId)
    .first();

  const statements = [
    c.env.DB.prepare(
      `UPDATE jobs SET status = 'done', error = NULL, mistral_pages_processed = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(build.pagesProcessed, jobId),
  ];
  if (!alreadyCharged) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO usage_events (id, user_id, job_id, kind, quantity) SELECT lower(hex(randomblob(16))), user_id, ?, 'ocr_pages', ? FROM jobs WHERE id = ?`,
      ).bind(jobId, build.pagesProcessed, jobId),
      c.env.DB.prepare(
        `UPDATE users SET quota_pages_used = quota_pages_used + ? WHERE id = (SELECT user_id FROM jobs WHERE id = ?)`,
      ).bind(build.pagesProcessed, jobId),
    );
  }
  await c.env.DB.batch(statements as Parameters<typeof c.env.DB.batch>[0]);

  return c.redirect("/admin/jobs");
});

/**
 * Re-runs only documentToDocxBuffer against the job's current stored
 * document.json — cheap, and works even for jobs whose Mistral response
 * wasn't captured (pre-dating this feature), as long as document.json exists.
 */
admin.post("/admin/jobs/:id/reproduce-docx", async (c) => {
  const jobId = c.req.param("id");
  const keys = jobKeys(jobId);
  const doc = await getJson<Document>(c.env.BUCKET, keys.document);
  if (!doc) return c.text("no stored document.json for this job — cannot reproduce docx", 409);

  const docx = await documentToDocxBuffer(doc);
  await putBytes(
    c.env.BUCKET,
    keys.docx,
    docx,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );

  return c.redirect("/admin/jobs");
});
