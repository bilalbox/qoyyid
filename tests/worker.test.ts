import { describe, expect, it } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

function createMockEnv(options?: {
	sessionRow?: Record<string, unknown> | null;
	jobRow?: Record<string, unknown> | null;
	assetsFetch?: (req: Request) => Promise<Response>;
}): Env {
	const db = {
		prepare(query: string) {
			return {
				bind(..._binds: unknown[]) {
					return {
						async first<T = unknown>(): Promise<T | null> {
							if (query.includes("FROM sessions")) {
								return (options?.sessionRow as T) ?? null;
							}
							if (query.includes("FROM jobs")) {
								return (options?.jobRow as T) ?? null;
							}
							return null;
						},
						async all<T = unknown>(): Promise<{ results: T[] }> {
							return { results: [] };
						},
						async run(): Promise<{ meta: { changes: number } }> {
							return { meta: { changes: 1 } };
						},
					};
				},
			};
		},
	};

	const assetsFetcher = {
		fetch:
			options?.assetsFetch ??
			(async () =>
				new Response("<!DOCTYPE html><html>SPA</html>", {
					headers: { "Content-Type": "text/html" },
				})),
	};

	return {
		DB: db as unknown as D1Database,
		ASSETS: assetsFetcher as unknown as Fetcher,
		BUCKET: {} as unknown as R2Bucket,
		MISTRAL_API_KEY: "test-key",
		GOOGLE_CLIENT_ID: "test-google-id",
		GOOGLE_CLIENT_SECRET: "test-google-secret",
		ADMIN_EMAILS: "admin@qoyyid.com",
		TURNSTILE_SECRET_KEY: "test-turnstile-secret",
		FCM_SERVICE_ACCOUNT_JSON: "{}",
		CLOUDFLARE_ACCOUNT_ID: "test-acc-id",
		R2_ACCESS_KEY_ID: "test-r2-id",
		R2_SECRET_ACCESS_KEY: "test-r2-secret",
		R2_BUCKET_NAME: "test-bucket",
	};
}

describe("Worker HTTP API & Middleware", () => {
	it("GET /health returns 200 { ok: true } without requiring auth", async () => {
		const env = createMockEnv();
		const req = new Request("http://localhost/health");
		const res = await worker.fetch(req, env);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ ok: true });
	});

	it("GET /me without session returns 401 unauthorized", async () => {
		const env = createMockEnv();
		const req = new Request("http://localhost/me");
		const res = await worker.fetch(req, env);

		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body).toEqual({ error: "unauthorized" });
	});

	it("GET /me with valid session cookie returns user data and quotas", async () => {
		const futureTimestamp = Math.floor(Date.now() / 1000) + 86400 * 10;
		const env = createMockEnv({
			sessionRow: {
				session_id: "valid-session",
				user_id: "user-42",
				expires_at: futureTimestamp,
				google_id: "g-42",
				email: "user@qoyyid.com",
				is_admin: 0,
				quota_pages_limit: 100,
				quota_pages_used: 15,
				quota_minutes_limit: 50,
				quota_minutes_used: 5,
			},
		});

		const req = new Request("http://localhost/me", {
			headers: {
				Cookie: "SESSION_ID=valid-session",
			},
		});
		const res = await worker.fetch(req, env);

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			id: string;
			email: string;
			is_admin: boolean;
			quota_pages_limit: number;
		};
		expect(body.id).toBe("user-42");
		expect(body.email).toBe("user@qoyyid.com");
		expect(body.is_admin).toBe(false);
		expect(body.quota_pages_limit).toBe(100);
	});

	it("GET /admin/api/users with non-admin session returns 403 forbidden", async () => {
		const futureTimestamp = Math.floor(Date.now() / 1000) + 86400 * 10;
		const env = createMockEnv({
			sessionRow: {
				session_id: "non-admin-session",
				user_id: "user-standard",
				expires_at: futureTimestamp,
				google_id: "g-std",
				email: "standard@qoyyid.com",
				is_admin: 0,
				quota_pages_limit: 10,
				quota_pages_used: 0,
				quota_minutes_limit: 10,
				quota_minutes_used: 0,
			},
		});

		const req = new Request("http://localhost/admin/api/users", {
			headers: {
				Authorization: "Bearer non-admin-session",
			},
		});
		const res = await worker.fetch(req, env);

		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body).toEqual({ error: "forbidden" });
	});

	it("GET /jobs/:id with Accept: text/html delegates to ASSETS SPA fetcher", async () => {
		let assetFetchCalled = false;
		const futureTimestamp = Math.floor(Date.now() / 1000) + 86400 * 10;
		const env = createMockEnv({
			sessionRow: {
				session_id: "valid-session",
				user_id: "user-42",
				expires_at: futureTimestamp,
				google_id: "g-42",
				email: "user@qoyyid.com",
				is_admin: 0,
				quota_pages_limit: 100,
				quota_pages_used: 15,
				quota_minutes_limit: 50,
				quota_minutes_used: 5,
			},
			assetsFetch: async () => {
				assetFetchCalled = true;
				return new Response("<!DOCTYPE html><html>Job Detail SPA</html>", {
					headers: { "Content-Type": "text/html" },
				});
			},
		});

		const req = new Request("http://localhost/jobs/job-123", {
			headers: {
				Cookie: "SESSION_ID=valid-session",
				Accept: "text/html,application/xhtml+xml",
			},
		});
		const res = await worker.fetch(req, env);

		expect(res.status).toBe(200);
		expect(assetFetchCalled).toBe(true);
		const html = await res.text();
		expect(html).toContain("Job Detail SPA");
	});

	it("GET /unknown returns 404 JSON", async () => {
		const env = createMockEnv();
		const req = new Request("http://localhost/unknown");
		const res = await worker.fetch(req, env);

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body).toEqual({ error: "not found" });
	});
});
