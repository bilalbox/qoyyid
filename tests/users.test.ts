import { describe, expect, it } from "vitest";
import {
	createUser,
	ensureAdminPromoted,
	generateIdFromEntropySize,
	invalidateSession,
	isAdminEmail,
	validateSessionToken,
} from "../src/users";

function createMockDb(rowToReturn: unknown = null) {
	const history: Array<{ query: string; binds: unknown[] }> = [];
	const db = {
		history,
		prepare(query: string) {
			return {
				bind(...binds: unknown[]) {
					history.push({ query, binds });
					return {
						async first<T = unknown>(): Promise<T | null> {
							return (rowToReturn as T) ?? null;
						},
						async run(): Promise<{ meta: { changes: number } }> {
							return { meta: { changes: 1 } };
						},
					};
				},
			};
		},
	};
	return db as unknown as D1Database & {
		history: Array<{ query: string; binds: unknown[] }>;
	};
}

describe("isAdminEmail", () => {
	it("correctly identifies admin emails case-insensitively and handles whitespace", () => {
		const adminEmails = "Admin@Example.com, super@test.org , owner@qoyyid.com";
		expect(isAdminEmail(adminEmails, "admin@example.com")).toBe(true);
		expect(isAdminEmail(adminEmails, "SUPER@test.org")).toBe(true);
		expect(isAdminEmail(adminEmails, "owner@qoyyid.com")).toBe(true);
		expect(isAdminEmail(adminEmails, "other@example.com")).toBe(false);
		expect(isAdminEmail(adminEmails, "")).toBe(false);
	});
});

describe("generateIdFromEntropySize", () => {
	it("generates non-empty string IDs without padding", () => {
		const id1 = generateIdFromEntropySize(16);
		const id2 = generateIdFromEntropySize(16);
		expect(typeof id1).toBe("string");
		expect(id1.length).toBeGreaterThan(10);
		expect(id1).not.toBe(id2);
		expect(id1).not.toContain("=");
	});
});

describe("createUser & ensureAdminPromoted", () => {
	it("creates a user record and runs D1 INSERT with proper admin flag", async () => {
		const db = createMockDb();
		const user = await createUser(db, "google-123", "user@test.org", {
			isAdmin: true,
		});

		expect(user.google_id).toBe("google-123");
		expect(user.email).toBe("user@test.org");
		expect(user.is_admin).toBe(1);
		expect(db.history.length).toBe(1);
		expect(db.history[0]?.query).toContain("INSERT INTO users");
		expect(db.history[0]?.binds).toContain("google-123");
		expect(db.history[0]?.binds).toContain("user@test.org");
		expect(db.history[0]?.binds).toContain(1);
	});

	it("promotes non-admin user to admin via D1 update", async () => {
		const db = createMockDb();
		const user = {
			id: "u1",
			google_id: "g1",
			email: "promoted@test.org",
			is_admin: 0,
			quota_pages_limit: 10,
			quota_pages_used: 0,
			quota_minutes_limit: 10,
			quota_minutes_used: 0,
		};

		const promoted = await ensureAdminPromoted(db, user);
		expect(promoted.is_admin).toBe(1);
		expect(db.history.length).toBe(1);
		expect(db.history[0]?.query).toContain(
			"UPDATE users SET is_admin = 1 WHERE id = ?",
		);
		expect(db.history[0]?.binds).toEqual(["u1"]);
	});

	it("leaves existing admin user untouched without running query", async () => {
		const db = createMockDb();
		const user = {
			id: "u2",
			google_id: "g2",
			email: "already-admin@test.org",
			is_admin: 1,
			quota_pages_limit: 10,
			quota_pages_used: 0,
			quota_minutes_limit: 10,
			quota_minutes_used: 0,
		};

		const same = await ensureAdminPromoted(db, user);
		expect(same.is_admin).toBe(1);
		expect(db.history.length).toBe(0);
	});
});

describe("validateSessionToken & invalidateSession", () => {
	it("returns null if session token is not found in database", async () => {
		const db = createMockDb(null);
		const result = await validateSessionToken(db, "missing-token");
		expect(result).toBeNull();
	});

	it("deletes session and returns null if session is expired", async () => {
		const expiredTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
		const db = createMockDb({
			session_id: "sess-1",
			user_id: "user-1",
			expires_at: expiredTimestamp,
			google_id: "g-1",
			email: "user@test.org",
			is_admin: 0,
			quota_pages_limit: 50,
			quota_pages_used: 5,
			quota_minutes_limit: 30,
			quota_minutes_used: 2,
		});

		const result = await validateSessionToken(db, "sess-1");
		expect(result).toBeNull();
		// Checked that DELETE FROM sessions was triggered
		const deleteQuery = db.history.find((h) =>
			h.query.includes("DELETE FROM sessions"),
		);
		expect(deleteQuery).toBeDefined();
		expect(deleteQuery?.binds).toContain("sess-1");
	});

	it("returns user and session if token is valid and not expired", async () => {
		const futureTimestamp = Math.floor(Date.now() / 1000) + 86400 * 20; // 20 days in future
		const db = createMockDb({
			session_id: "sess-valid",
			user_id: "user-valid",
			expires_at: futureTimestamp,
			google_id: "g-valid",
			email: "valid@test.org",
			is_admin: 1,
			quota_pages_limit: 100,
			quota_pages_used: 10,
			quota_minutes_limit: 60,
			quota_minutes_used: 5,
		});

		const result = await validateSessionToken(db, "sess-valid");
		expect(result).not.toBeNull();
		expect(result?.user.id).toBe("user-valid");
		expect(result?.user.email).toBe("valid@test.org");
		expect(result?.user.is_admin).toBe(1);
		expect(result?.session.id).toBe("sess-valid");
	});

	it("invalidates session by deleting it from D1", async () => {
		const db = createMockDb();
		await invalidateSession(db, "sess-to-kill");
		expect(db.history.length).toBe(1);
		expect(db.history[0]?.query).toContain("DELETE FROM sessions WHERE id = ?");
		expect(db.history[0]?.binds).toEqual(["sess-to-kill"]);
	});
});
