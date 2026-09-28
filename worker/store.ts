import { validateSpec, type Spec } from "../shared/spec";

// PUBLISH_API_KEY is an operator-only secret for rotate/revoke. Publishing itself is open.
export interface Env { DB: D1Database; ASSETS: Fetcher; PUBLISH_API_KEY: string; PUBLISH_LIMITER: RateLimit; UPDATE_LIMITER: RateLimit }
export type Row = { id: string; title: string; spec: string; token_hash: string; created_at: string; expires_at: string | null; revoked_at: string | null };
export type Published = { id: string; url: string; title: string; createdAt: string; expiresAt: string | null };

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function hash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function newToken() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
export function secureEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Always consult the primary: revocation must not race a replica's stale state.
export const primary = (env: Env) => env.DB.withSession("first-primary");

export function shareUrl(origin: string, id: string, token: string) {
  const url = new URL(`/d/${id}`, origin);
  url.searchParams.set("token", token);
  return url.href;
}

// The editor autosaves, so updates get a more generous budget than new links.
export async function rateLimitUpdates(env: Env, request: Request) {
  const client = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await env.UPDATE_LIMITER.limit({ key: client })).success) throw new HttpError(429, "Too many saves. Try again in a moment.");
}

export async function rateLimit(env: Env, request: Request) {
  const client = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await env.PUBLISH_LIMITER.limit({ key: client })).success) throw new HttpError(429, "Too many shares. Try again in a minute.");
}

export async function createDiagram(env: Env, origin: string, input: { title: string; spec: unknown; expiresAt?: string | null }): Promise<Published & { spec: Spec }> {
  const expiresAt = input.expiresAt ? new Date(input.expiresAt).toISOString() : null;
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) throw new HttpError(400, "expiresAt must be in the future");
  let spec: Spec;
  try { spec = validateSpec(input.spec).spec; } catch (error) { throw new HttpError(422, (error as Error).message); }
  const id = crypto.randomUUID();
  const token = newToken();
  const createdAt = new Date().toISOString();
  await primary(env).prepare("INSERT INTO diagrams (id, title, spec, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, input.title, JSON.stringify(spec), await hash(token), createdAt, expiresAt).run();
  return { id, url: shareUrl(origin, id, token), title: input.title, createdAt, expiresAt, spec };
}

// Holding the share token is the only credential: anyone who can view can update.
export async function updateDiagram(env: Env, origin: string, id: string, token: string | null, input: { title?: string; spec: unknown }): Promise<(Published & { spec: Spec }) | null> {
  const row = await readDiagram(env, id, token);
  if (!row || !token) return null;
  let spec: Spec;
  try { spec = validateSpec(input.spec).spec; } catch (error) { throw new HttpError(422, (error as Error).message); }
  const title = input.title ?? row.title;
  await primary(env).prepare("UPDATE diagrams SET spec = ?, title = ? WHERE id = ?").bind(JSON.stringify(spec), title, id).run();
  return { id, url: shareUrl(origin, id, token), title, createdAt: row.created_at, expiresAt: row.expires_at, spec };
}

export async function readDiagram(env: Env, id: string, token: string | null) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[a-f0-9-]{36}$/.test(id)) return null;
  const row = await primary(env).prepare("SELECT * FROM diagrams WHERE id = ?").bind(id).first<Row>();
  if (!row || row.revoked_at || (row.expires_at && Date.parse(row.expires_at) <= Date.now())) return null;
  return secureEqual(await hash(token), row.token_hash) ? row : null;
}
