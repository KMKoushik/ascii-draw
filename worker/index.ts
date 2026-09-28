import { z } from "zod";
import { validateSpec } from "../shared/spec";

// PUBLISH_API_KEY is an operator-only secret for rotate/revoke. Publishing itself is open.
export interface Env { DB: D1Database; ASSETS: Fetcher; PUBLISH_API_KEY: string; PUBLISH_LIMITER: RateLimit }
type Row = { id: string; title: string; spec: string; token_hash: string; created_at: string; expires_at: string | null; revoked_at: string | null };
const idPattern = "[a-f0-9-]{36}";
const maxBodyBytes = 256 * 1024;
const payloadSchema = z.object({
  title: z.string().trim().min(1).max(160).default("Untitled diagram"),
  spec: z.unknown(),
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
}).strict();

export async function hash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
function newToken() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function secureEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function json(value: unknown, status = 200) { return Response.json(value, { status }); }
const notFound = () => json({ error: "Diagram unavailable. Use the complete, current access link." }, 404);

async function readBody(request: Request) {
  if (!request.headers.get("Content-Type")?.split(";")[0].trim().match(/^application\/json$/i)) {
    throw new HttpError(415, "Send Content-Type: application/json");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "A JSON body is required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBodyBytes) { await reader.cancel(); throw new HttpError(413, "JSON must be at most 256 KiB"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new HttpError(400, "Invalid JSON"); }
}
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

async function requireAdmin(request: Request, env: Env) {
  if (!env.PUBLISH_API_KEY) throw new HttpError(503, "Management is not configured");
  const key = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!key || key.length > 512 || !secureEqual(await hash(key), await hash(env.PUBLISH_API_KEY))) {
    throw new HttpError(401, "A valid admin key is required");
  }
}
async function authorizedDiagram(request: Request, db: D1DatabaseSession, id: string) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await db.prepare("SELECT * FROM diagrams WHERE id = ?").bind(id).first<Row>();
  if (!row || row.revoked_at || (row.expires_at && Date.parse(row.expires_at) <= Date.now())) return null;
  return secureEqual(await hash(token), row.token_hash) ? row : null;
}
function linkResponse(request: Request, id: string, token: string) {
  const url = new URL(`/d/${id}`, request.url);
  url.searchParams.set("token", token);
  return { id, url: url.href };
}
async function route(request: Request, env: Env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  // Always consult the primary: revocation must not race a replica's stale state.
  const db = env.DB.withSession("first-primary");

  if (pathname === "/api/diagrams" && method === "POST") {
    const client = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (!(await env.PUBLISH_LIMITER.limit({ key: client })).success) throw new HttpError(429, "Too many shares. Try again in a minute.");
    const payload = payloadSchema.safeParse(await readBody(request));
    if (!payload.success) throw new HttpError(400, payload.error.issues[0].message);
    const { title, spec: input, expiresAt } = payload.data;
    const expires = expiresAt ? new Date(expiresAt).toISOString() : null;
    if (expires && Date.parse(expires) <= Date.now()) throw new HttpError(400, "expiresAt must be in the future");
    let spec;
    try { spec = validateSpec(input).spec; } catch (error) { throw new HttpError(422, (error as Error).message); }
    const id = crypto.randomUUID();
    const token = newToken();
    const createdAt = new Date().toISOString();
    await db.prepare("INSERT INTO diagrams (id, title, spec, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, title, JSON.stringify(spec), await hash(token), createdAt, expires).run();
    return json({ ...linkResponse(request, id, token), title, createdAt, expiresAt: expires }, 201);
  }

  const management = pathname.match(new RegExp(`^/api/diagrams/(${idPattern})/(rotate-token|revoke)$`));
  if (management && method === "POST") {
    await requireAdmin(request, env);
    const [, id, action] = management;
    const row = await db.prepare("SELECT id FROM diagrams WHERE id = ?").bind(id).first();
    if (!row) return notFound();
    if (action === "revoke") {
      await db.prepare("UPDATE diagrams SET revoked_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
      return json({ id, revoked: true });
    }
    const token = newToken();
    await db.prepare("UPDATE diagrams SET token_hash = ?, revoked_at = NULL WHERE id = ?").bind(await hash(token), id).run();
    return json(linkResponse(request, id, token));
  }

  const apiDiagram = pathname.match(new RegExp(`^/api/diagrams/(${idPattern})$`));
  const viewer = pathname.match(new RegExp(`^/d/(${idPattern})$`));
  if ((apiDiagram || viewer) && (method === "GET" || method === "HEAD")) {
    const row = await authorizedDiagram(request, db, (apiDiagram ?? viewer)![1]);
    if (!row) {
      if (apiDiagram) return notFound();
      // The locked viewer contains no diagram data, title, or token.
      const shell = await env.ASSETS.fetch(new Request(new URL("/", request.url), { method }));
      return new Response(shell.body, { status: 404, headers: shell.headers });
    }
    if (apiDiagram) return json({ id: row.id, title: row.title, spec: JSON.parse(row.spec), createdAt: row.created_at, expiresAt: row.expires_at });
    return env.ASSETS.fetch(new Request(new URL("/", request.url), { method }));
  }
  if (pathname.startsWith("/api/") || pathname.startsWith("/d/")) return notFound();
  if (method !== "GET" && method !== "HEAD") return json({ error: "Method not allowed" }, 405);
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try { response = await route(request, env); }
    catch (error) {
      response = error instanceof HttpError ? json({ error: error.message }, error.status) : json({ error: "Request failed. Please try again." }, 500);
    }
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    const development = import.meta.env?.DEV === true;
    headers.set("Content-Security-Policy", `default-src 'self'; script-src 'self'${development ? " 'unsafe-inline'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'${development ? " ws: wss:" : ""}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`);
    return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, headers });
  },
};
