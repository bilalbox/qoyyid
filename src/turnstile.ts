import type { Env } from "./types";

const COOKIE_NAME = "turnstile_verified";
const VERIFIED_TTL_S = 60 * 5; // must reach /auth/google shortly after solving the widget

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Signed, expiring cookie value proving a Turnstile challenge was solved
 * recently — plain "turnstile_ok=1" would let a bot skip the widget and set
 * the cookie itself, so the payload is HMAC'd with TURNSTILE_SECRET_KEY.
 */
export async function signTurnstileCookie(secret: string): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + VERIFIED_TTL_S;
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(expires)));
  return `${expires}.${toBase64Url(sig)}`;
}

export async function verifyTurnstileCookie(secret: string, value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const [expiresStr, sig] = value.split(".");
  if (!expiresStr || !sig) return false;
  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false;

  const key = await hmacKey(secret);
  const expected = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expiresStr));
  return sig === toBase64Url(expected);
}

export const TURNSTILE_COOKIE_NAME = COOKIE_NAME;
export const TURNSTILE_COOKIE_MAX_AGE_S = VERIFIED_TTL_S;

export async function verifyTurnstileToken(env: Env, token: string, remoteIp?: string): Promise<boolean> {
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return false;
  const result = (await res.json()) as { success: boolean };
  return result.success === true;
}
