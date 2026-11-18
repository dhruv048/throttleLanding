// Small helpers for Paddle Billing: API calls and webhook signatures.
//
// PADDLE_ENV picks sandbox or live. When unset it follows the API key:
// sandbox keys contain "_sdbx_", anything else is treated as live.
const API_KEY = Deno.env.get("PADDLE_API_KEY") ?? "";
const ENV = (Deno.env.get("PADDLE_ENV") ?? (API_KEY.includes("_sdbx_") ? "sandbox" : "live")).toLowerCase();
const API_BASE = ENV === "sandbox" ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";

// Calls the Paddle API and returns its `data`. Throws on any non-2xx reply.
export async function paddleApi(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<Record<string, any>> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "Paddle-Version": "1",
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Paddle ${opts.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text).data;
}

const enc = new TextEncoder();

// Checks a Paddle-Signature header ("ts=…;h1=…") against the raw body.
// Paddle signs "<ts>:<body>" with HMAC-SHA256 using the endpoint's secret key.
export async function verifyPaddleSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!header || !secret) return false;
  const parts: Record<string, string[]> = {};
  for (const piece of header.split(";")) {
    const [k, v] = piece.split("=");
    if (k && v) (parts[k.trim()] ??= []).push(v.trim());
  }
  const ts = parts.ts?.[0];
  const sigs = parts.h1 ?? [];
  if (!ts || sigs.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${ts}:${rawBody}`)));
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => timingSafeEqual(s, expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
