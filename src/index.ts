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
app.use("/admin/*", requireAuth, requireAdmin);
app.route("/", admin);

app.get("/me", (c) => {
  const { id, email, is_admin, quota_pages_limit, quota_pages_used } = c.get("user");
  return json({ id, email, is_admin: Boolean(is_admin), quota_pages_limit, quota_pages_used });
});

app.post("/jobs", (c) => handleCreateJob(c.req.raw, c.env, c.executionCtx, c.get("user")));
app.get("/jobs", (c) => handleListJobs(c.env, c.get("user")));
app.get("/jobs/:id", (c) => handleGetJob(c.env, c.get("user"), c.req.param("id")));
app.get("/jobs/:id/docx", (c) => handleGetDocx(c.env, c.get("user"), c.req.param("id")));
app.get("/jobs/:id/document", (c) => handleGetDocument(c.env, c.get("user"), c.req.param("id")));

app.notFound((c) => json({ error: "not found" }, 404));
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
