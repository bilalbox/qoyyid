import { Hono } from "hono";
import type { Env } from "./types";
import type { Session, User } from "./users";

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
<body><h1>${escapeHtml(title)}</h1><nav><a href="/admin/users">Users</a> | <a href="/admin/invites">Invites</a></nav>
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
