import { encodeBase32LowerCaseNoPadding } from "@oslojs/encoding";

export interface User {
  id: string;
  google_id: string;
  email: string;
  is_admin: number;
  quota_pages_limit: number;
  quota_pages_used: number;
  quota_minutes_limit: number;
  quota_minutes_used: number;
}

export interface Session {
  id: string;
  user_id: string;
  expires_at: number;
}

const SESSION_DURATION_S = 60 * 60 * 24 * 30; // 30 days
const SESSION_RENEW_THRESHOLD_S = 60 * 60 * 24 * 15; // renew when <15 days left

export function generateIdFromEntropySize(size: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return encodeBase32LowerCaseNoPadding(bytes);
}

export function isAdminEmail(adminEmails: string, email: string): boolean {
  const target = email.trim().toLowerCase();
  return adminEmails
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(target);
}

export async function getUserByGoogleId(db: D1Database, googleId: string): Promise<User | null> {
  return db.prepare("SELECT * FROM users WHERE google_id = ?").bind(googleId).first<User>();
}

export async function createUser(
  db: D1Database,
  googleId: string,
  email: string,
  { isAdmin }: { isAdmin: boolean },
): Promise<User> {
  const id = generateIdFromEntropySize(16);
  await db
    .prepare(
      `INSERT INTO users (id, google_id, email, is_admin, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
    )
    .bind(id, googleId, email, isAdmin ? 1 : 0)
    .run();

  return {
    id,
    google_id: googleId,
    email,
    is_admin: isAdmin ? 1 : 0,
    quota_pages_limit: 0,
    quota_pages_used: 0,
    quota_minutes_limit: 0,
    quota_minutes_used: 0,
  };
}

/** Promote an existing user to admin if their email was added to ADMIN_EMAILS after signup. */
export async function ensureAdminPromoted(db: D1Database, user: User): Promise<User> {
  if (user.is_admin) return user;
  await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").bind(user.id).run();
  return { ...user, is_admin: 1 };
}

export async function createSession(db: D1Database, userId: string): Promise<Session> {
  const id = generateIdFromEntropySize(20);
  const expires_at = Math.floor(Date.now() / 1000) + SESSION_DURATION_S;

  await db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`).bind(id, userId, expires_at).run();

  return { id, user_id: userId, expires_at };
}

export async function validateSessionToken(
  db: D1Database,
  sessionId: string,
): Promise<{ user: User; session: Session } | null> {
  const result = await db
    .prepare(
      `SELECT sessions.id as session_id, sessions.user_id, sessions.expires_at,
              users.id as user_id, users.google_id, users.email, users.is_admin,
              users.quota_pages_limit, users.quota_pages_used,
              users.quota_minutes_limit, users.quota_minutes_used
       FROM sessions
       INNER JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = ?`,
    )
    .bind(sessionId)
    .first<any>();

  if (!result) return null;

  const session: Session = {
    id: result.session_id,
    user_id: result.user_id,
    expires_at: result.expires_at,
  };
  const user: User = {
    id: result.user_id,
    google_id: result.google_id,
    email: result.email,
    is_admin: result.is_admin,
    quota_pages_limit: result.quota_pages_limit,
    quota_pages_used: result.quota_pages_used,
    quota_minutes_limit: result.quota_minutes_limit,
    quota_minutes_used: result.quota_minutes_used,
  };

  if (Date.now() / 1000 >= session.expires_at) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(session.id).run();
    return null;
  }

  if (Date.now() / 1000 >= session.expires_at - SESSION_RENEW_THRESHOLD_S) {
    session.expires_at = Math.floor(Date.now() / 1000) + SESSION_DURATION_S;
    await db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(session.expires_at, session.id).run();
  }

  return { user, session };
}

export async function invalidateSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}
