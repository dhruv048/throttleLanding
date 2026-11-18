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

// ---------------------------------------------------------------- Webhook IPs
// Paddle publishes the addresses it sends webhooks from at <api>/ips
// (sandbox and live differ). We fetch the list instead of hard-coding it,
// cache it for an hour, and keep the last good copy if a refresh fails.
let ipCache: { at: number; cidrs: string[] } | null = null;

export async function paddleWebhookCidrs(): Promise<string[]> {
  if (ipCache && Date.now() - ipCache.at < 60 * 60 * 1000) return ipCache.cidrs;
  try {
    const res = await fetch(`${API_BASE}/ips`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const cidrs: unknown = (await res.json())?.data?.ipv4_cidrs;
    if (!Array.isArray(cidrs) || cidrs.length === 0) throw new Error("empty list");
    ipCache = { at: Date.now(), cidrs: cidrs.map(String) };
  } catch (err) {
    if (!ipCache) throw new Error(`Couldn't load Paddle IPs from ${API_BASE}/ips: ${err}`);
    console.warn("paddle: IP list refresh failed, using the last good copy", err);
  }
  return ipCache.cidrs;
}

// The caller's address as Supabase's edge sees it.
export function clientIp(req: Request): string | null {
  const h = req.headers;
  return h.get("cf-connecting-ip")?.trim() ||
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n;
}

export function ipInCidrs(ip: string, cidrs: string[]): boolean {
  const addr = ipv4ToInt(ip.replace(/^::ffff:/, ""));
  if (addr === null) return false;
  return cidrs.some((cidr) => {
    const [base, bitsStr] = cidr.split("/");
    const baseInt = ipv4ToInt(base);
    const bits = bitsStr === undefined ? 32 : Number(bitsStr);
    if (baseInt === null || !(bits >= 0 && bits <= 32)) return false;
    const size = 2 ** (32 - bits);
    return Math.floor(addr / size) === Math.floor(baseInt / size);
  });
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
