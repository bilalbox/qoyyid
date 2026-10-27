import type { Env } from "./types";

interface ServiceAccount {
	client_email: string;
	private_key: string;
	project_id: string;
}

interface CachedToken {
	accessToken: string;
	expiresAt: number; // epoch seconds
}

// Module-scope cache: Workers reuse the same isolate across requests within
// a short window, so this avoids re-signing a JWT and round-tripping to
// Google's token endpoint on every job completion.
let cachedToken: CachedToken | null = null;

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
	const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let binary = "";
	for (const b of arr) binary += String.fromCharCode(b);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function pemToDer(pem: string): ArrayBuffer {
	const stripped = pem
		.replace(/-----BEGIN PRIVATE KEY-----/, "")
		.replace(/-----END PRIVATE KEY-----/, "")
		.replace(/\s+/g, "");
	const binary = atob(stripped);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}

async function signJwt(account: ServiceAccount): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: "RS256", typ: "JWT" };
	const claims = {
		iss: account.client_email,
		scope: "https://www.googleapis.com/auth/firebase.messaging",
		aud: "https://oauth2.googleapis.com/token",
		iat: now,
		exp: now + 3600,
	};

	const encoder = new TextEncoder();
	const signingInput = `${toBase64Url(encoder.encode(JSON.stringify(header)))}.${toBase64Url(encoder.encode(JSON.stringify(claims)))}`;

	const key = await crypto.subtle.importKey(
		"pkcs8",
		pemToDer(account.private_key),
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		key,
		encoder.encode(signingInput),
	);

	return `${signingInput}.${toBase64Url(signature)}`;
}

async function getAccessToken(account: ServiceAccount): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	if (cachedToken && cachedToken.expiresAt - 60 > now)
		return cachedToken.accessToken;

	const assertion = await signJwt(account);
	const res = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion,
		}),
	});
	if (!res.ok)
		throw new Error(
			`FCM token exchange failed: ${res.status} ${await res.text()}`,
		);
	const data = (await res.json()) as {
		access_token: string;
		expires_in: number;
	};

	cachedToken = {
		accessToken: data.access_token,
		expiresAt: now + data.expires_in,
	};
	return data.access_token;
}

interface PushNotification {
	title: string;
	body: string;
	data?: Record<string, string>;
}

async function sendToToken(
	projectId: string,
	accessToken: string,
	token: string,
	notification: PushNotification,
): Promise<{ ok: true } | { ok: false; unregistered: boolean }> {
	const res = await fetch(
		`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				message: {
					token,
					notification: { title: notification.title, body: notification.body },
					data: notification.data,
				},
			}),
		},
	);
	if (res.ok) return { ok: true };

	const body = (await res.json().catch(() => null)) as {
		error?: { status?: string; details?: { errorCode?: string }[] };
	} | null;
	const errorCode = body?.error?.details?.find((d) => d.errorCode)?.errorCode;
	const unregistered =
		errorCode === "UNREGISTERED" || body?.error?.status === "NOT_FOUND";
	return { ok: false, unregistered };
}

/**
 * Sends a push notification to every device registered for a user. Never
 * throws — job finalization (finalizeJob/markJobFailed) must not fail or
 * retry because a notification provider is down.
 */
export async function notifyUser(
	env: Env,
	userId: string,
	notification: PushNotification,
): Promise<void> {
	try {
		if (!env.FCM_SERVICE_ACCOUNT_JSON) return;
		const account = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON) as ServiceAccount;

		const { results } = await env.DB.prepare(
			"SELECT token FROM fcm_tokens WHERE user_id = ?",
		)
			.bind(userId)
			.all<{ token: string }>();
		if (results.length === 0) return;

		const accessToken = await getAccessToken(account);

		await Promise.allSettled(
			results.map(async ({ token }) => {
				const result = await sendToToken(
					account.project_id,
					accessToken,
					token,
					notification,
				);
				if (!result.ok && result.unregistered) {
					await env.DB.prepare("DELETE FROM fcm_tokens WHERE token = ?")
						.bind(token)
						.run();
				}
			}),
		);
	} catch (e) {
		console.error("fcm notify failed", e);
	}
}
