import { Google, generateCodeVerifier, generateState } from "arctic";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import {
	signTurnstileCookie,
	TURNSTILE_COOKIE_MAX_AGE_S,
	TURNSTILE_COOKIE_NAME,
	verifyTurnstileCookie,
	verifyTurnstileToken,
} from "./turnstile";
import type { Env } from "./types";
import type { Session, User } from "./users";
import {
	createSession,
	createUser,
	ensureAdminPromoted,
	getUserByGoogleId,
	invalidateSession,
	isAdminEmail,
} from "./users";

type Variables = { user: User; session: Session };

const OAUTH_COOKIE_MAX_AGE_S = 60 * 10;
const SESSION_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30;

export const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

auth.post("/auth/turnstile/verify", async (c) => {
	const { token } = await c.req
		.json<{ token?: string }>()
		.catch(() => ({ token: undefined }));
	if (!token) return c.json({ error: "missing token" }, 400);

	const remoteIp = c.req.header("CF-Connecting-IP") ?? undefined;
	const ok = await verifyTurnstileToken(c.env, token, remoteIp);
	if (!ok) return c.json({ error: "turnstile challenge failed" }, 403);

	// setCookie() stages the header on `c` — must return via c.json() (not the
	// standalone json() helper, which builds an unrelated Response) or the
	// Set-Cookie header never reaches the client.
	setCookie(
		c,
		TURNSTILE_COOKIE_NAME,
		await signTurnstileCookie(c.env.TURNSTILE_SECRET_KEY),
		{
			path: "/",
			secure: true,
			httpOnly: true,
			sameSite: "Lax",
			maxAge: TURNSTILE_COOKIE_MAX_AGE_S,
		},
	);
	return c.json({ success: true });
});

auth.get("/auth/google", async (c) => {
	const verified = await verifyTurnstileCookie(
		c.env.TURNSTILE_SECRET_KEY,
		getCookie(c, TURNSTILE_COOKIE_NAME),
	);
	if (!verified) return c.redirect("/login?error=turnstile_required");

	const state = generateState();
	const codeVerifier = generateCodeVerifier();
	const redirectURI = new URL("/auth/google/callback", c.req.url).toString();
	const google = new Google(
		c.env.GOOGLE_CLIENT_ID,
		c.env.GOOGLE_CLIENT_SECRET,
		redirectURI,
	);
	const url = google.createAuthorizationURL(state, codeVerifier, [
		"profile",
		"email",
	]);

	setCookie(c, "google_oauth_state", state, {
		path: "/",
		secure: true,
		httpOnly: true,
		maxAge: OAUTH_COOKIE_MAX_AGE_S,
		sameSite: "Lax",
	});
	setCookie(c, "google_code_verifier", codeVerifier, {
		path: "/",
		secure: true,
		httpOnly: true,
		maxAge: OAUTH_COOKIE_MAX_AGE_S,
		sameSite: "Lax",
	});

	return c.redirect(url.toString());
});

auth.get("/auth/google/callback", async (c) => {
	const code = c.req.query("code");
	const state = c.req.query("state");
	const storedState = getCookie(c, "google_oauth_state");
	const codeVerifier = getCookie(c, "google_code_verifier");

	if (
		!code ||
		!state ||
		!storedState ||
		state !== storedState ||
		!codeVerifier
	) {
		return c.json({ error: "invalid oauth state" }, 400);
	}

	const redirectURI = new URL("/auth/google/callback", c.req.url).toString();
	const google = new Google(
		c.env.GOOGLE_CLIENT_ID,
		c.env.GOOGLE_CLIENT_SECRET,
		redirectURI,
	);

	try {
		const tokens = await google.validateAuthorizationCode(code, codeVerifier);
		const response = await fetch(
			"https://openidconnect.googleapis.com/v1/userinfo",
			{
				headers: { Authorization: `Bearer ${tokens.accessToken()}` },
			},
		);
		const googleUser = (await response.json()) as {
			sub: string;
			email: string;
		};

		let user = await getUserByGoogleId(c.env.DB, googleUser.sub);
		const isAdmin = isAdminEmail(c.env.ADMIN_EMAILS, googleUser.email);

		if (!user) {
			// ADMIN_EMAILS membership satisfies the invite requirement — solves the
			// chicken-and-egg bootstrap problem for the first production admin.
			if (!isAdmin) {
				const invite = await c.env.DB.prepare(
					"SELECT email FROM invites WHERE email = ? AND used_at IS NULL",
				)
					.bind(googleUser.email)
					.first();
				if (!invite) {
					return c.redirect("/login?error=invite_required");
				}
			}

			user = await createUser(c.env.DB, googleUser.sub, googleUser.email, {
				isAdmin,
			});

			await c.env.DB.prepare(
				"UPDATE invites SET used_at = CURRENT_TIMESTAMP, used_by = ? WHERE email = ?",
			)
				.bind(user.id, googleUser.email)
				.run();
		} else if (isAdmin && !user.is_admin) {
			// Covers promoting a user added to ADMIN_EMAILS after their account already existed.
			user = await ensureAdminPromoted(c.env.DB, user);
		}

		const session = await createSession(c.env.DB, user.id);
		setCookie(c, "SESSION_ID", session.id, {
			path: "/",
			secure: true,
			httpOnly: true,
			sameSite: "Lax",
			maxAge: SESSION_COOKIE_MAX_AGE_S,
		});

		return c.redirect("/");
	} catch (err) {
		console.error("oauth failed", err);
		return c.json({ error: "oauth failed" }, 400);
	}
});

auth.post("/auth/logout", async (c) => {
	const sessionId = getCookie(c, "SESSION_ID");
	if (sessionId) await invalidateSession(c.env.DB, sessionId);
	setCookie(c, "SESSION_ID", "", { path: "/", maxAge: 0 });
	return c.json({ success: true });
});
