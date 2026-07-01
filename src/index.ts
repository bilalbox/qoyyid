import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import type { Env } from "./types";
import { json } from "./http";
import { auth } from "./auth";
import { admin } from "./admin";
import { handleCreateJob, handleGetDocument, handleGetDocx, handleGetJob, handleListJobs } from "./jobs";
import { validateSessionToken } from "./users";
import type { Session, User } from "./users";
import { pollPendingBatches } from "./cron";

type Variables = { user: User; session: Session };

// No CORS needed: wrangler.toml serves the SvelteKit SPA build (./public) and
// this Hono API from the same Worker/origin via [assets] run_worker_first,
// matching the pattern used by /home/bilal/mycode/parse.
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const requireAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  const sessionId = getCookie(c, "SESSION_ID") || c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!sessionId) return json({ error: "unauthorized" }, 401);
  const result = await validateSessionToken(c.env.DB, sessionId);
  if (!result) return json({ error: "unauthorized" }, 401);
  c.set("user", result.user);
  c.set("session", result.session);
  return next();
});

const requireAdmin = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  const user = c.get("user");
  if (!user?.is_admin) return json({ error: "forbidden" }, 403);
  return next();
});

app.get("/health", (c) => json({ ok: true }));

app.route("/", auth);

app.use("/jobs/*", requireAuth);
app.use("/me", requireAuth);
app.use("/me/*", requireAuth);
app.use("/admin/*", requireAuth, requireAdmin);
app.route("/", admin);

app.get("/me", (c) => {
  const { id, email, is_admin, quota_pages_limit, quota_pages_used } = c.get("user");
  return json({ id, email, is_admin: Boolean(is_admin), quota_pages_limit, quota_pages_used });
});

app.post("/me/fcm-token", async (c) => {
  const { token } = await c.req.json<{ token?: string }>().catch(() => ({ token: undefined }));
  if (!token) return json({ error: "missing token" }, 400);

  // Token is globally unique in FCM; re-registering under a new user (shared
  // device, different Google account) should move it rather than conflict.
  await c.env.DB.prepare(
    `INSERT INTO fcm_tokens (token, user_id) VALUES (?, ?)
     ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id`,
  )
    .bind(token, c.get("user").id)
    .run();

  return json({ success: true });
});

app.delete("/me/fcm-token", async (c) => {
  const { token } = await c.req.json<{ token?: string }>().catch(() => ({ token: undefined }));
  if (!token) return json({ error: "missing token" }, 400);
  await c.env.DB.prepare("DELETE FROM fcm_tokens WHERE token = ? AND user_id = ?")
    .bind(token, c.get("user").id)
    .run();
  return json({ success: true });
});

app.post("/jobs", (c) => handleCreateJob(c.req.raw, c.env, c.executionCtx, c.get("user")));
app.get("/jobs", (c) => handleListJobs(c.env, c.get("user")));
app.get("/jobs/:id", (c) => handleGetJob(c.env, c.get("user"), c.req.param("id")));
app.get("/jobs/:id/docx", (c) => handleGetDocx(c.env, c.get("user"), c.req.param("id")));
app.get("/jobs/:id/document", (c) => handleGetDocument(c.env, c.get("user"), c.req.param("id")));

// /admin/* is in run_worker_first (see wrangler.jsonc), so this worker — not
// the platform's SPA fallback — owns 404s under that prefix. Unmatched GETs
// there are SvelteKit admin pages (/admin/users, /admin/invites, /admin/jobs);
// hand them to the asset binding so its own single-page-application fallback
// serves index.html and the client router takes over. JSON API misses under
// /admin/api/* still 404 as JSON.
app.notFound((c) => {
  const url = new URL(c.req.url);
  if (c.req.method === "GET" && url.pathname.startsWith("/admin/") && !url.pathname.startsWith("/admin/api/")) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return json({ error: "not found" }, 404);
});
app.onError((err, c) => {
  console.error(err);
  return json({ error: err instanceof Error ? err.message : "internal error" }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(pollPendingBatches(env));
  },
};
