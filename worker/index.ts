import { z } from "zod";
import { createDiagram, hash, HttpError, newToken, primary, rateLimit, rateLimitUpdates, readDiagram, secureEqual, shareUrl, updateDiagram, type Env } from "./store";
import { mcpHandler } from "./mcp";
import { oembed, previewImage, withPreviewTags } from "./og";

export type { Env };
const idPattern = "[a-f0-9-]{36}";
const maxBodyBytes = 256 * 1024;
const payloadSchema = z.object({
  title: z.string().trim().min(1).max(160).default("Untitled diagram"),
  spec: z.unknown(),
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
}).strict();
const updateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  spec: z.unknown(),
}).strict();

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

async function requireAdmin(request: Request, env: Env) {
  if (!env.PUBLISH_API_KEY) throw new HttpError(503, "Management is not configured");
  const key = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!key || key.length > 512 || !secureEqual(await hash(key), await hash(env.PUBLISH_API_KEY))) {
    throw new HttpError(401, "A valid admin key is required");
  }
}

async function route(request: Request, env: Env, ctx: ExecutionContext) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if (pathname === "/mcp") return mcpHandler(request, env, ctx);

  if (pathname === "/api/diagrams" && method === "POST") {
    await rateLimit(env, request);
    const payload = payloadSchema.safeParse(await readBody(request));
    if (!payload.success) throw new HttpError(400, payload.error.issues[0].message);
    const { spec: _spec, ...created } = await createDiagram(env, url.origin, payload.data);
    return json(created, 201);
  }

  const management = pathname.match(new RegExp(`^/api/diagrams/(${idPattern})/(rotate-token|revoke)$`));
  if (management && method === "POST") {
    await requireAdmin(request, env);
    const [, id, action] = management;
    const db = primary(env);
    const row = await db.prepare("SELECT id FROM diagrams WHERE id = ?").bind(id).first();
    if (!row) return notFound();
    if (action === "revoke") {
      await db.prepare("UPDATE diagrams SET revoked_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
      return json({ id, revoked: true });
    }
    const token = newToken();
    await db.prepare("UPDATE diagrams SET token_hash = ?, revoked_at = NULL WHERE id = ?").bind(await hash(token), id).run();
    return json({ id, url: shareUrl(url.origin, id, token) });
  }

  const updateTarget = pathname.match(new RegExp(`^/api/diagrams/(${idPattern})$`));
  if (updateTarget && method === "PUT") {
    await rateLimitUpdates(env, request);
    const payload = updateSchema.safeParse(await readBody(request));
    if (!payload.success) throw new HttpError(400, payload.error.issues[0].message);
    const updated = await updateDiagram(env, url.origin, updateTarget[1], url.searchParams.get("token"), payload.data);
    if (!updated) return notFound();
    const { spec: _spec, ...published } = updated;
    return json(published);
  }

  const apiDiagram = pathname.match(new RegExp(`^/api/diagrams/(${idPattern})$`));
  const viewer = pathname.match(new RegExp(`^/d/(${idPattern})$`));
  if ((apiDiagram || viewer) && (method === "GET" || method === "HEAD")) {
    const row = await readDiagram(env, (apiDiagram ?? viewer)![1], url.searchParams.get("token"));
    if (!row) {
      if (apiDiagram) return notFound();
      // The locked viewer contains no diagram data, title, or token.
      const shell = await env.ASSETS.fetch(new Request(new URL("/", request.url), { method }));
      return new Response(shell.body, { status: 404, headers: shell.headers });
    }
    if (apiDiagram) return json({ id: row.id, title: row.title, spec: JSON.parse(row.spec), createdAt: row.created_at, expiresAt: row.expires_at });
    return withPreviewTags(await env.ASSETS.fetch(new Request(new URL("/", request.url), { method })), url, row);
  }
  if (pathname === "/oembed" && (method === "GET" || method === "HEAD")) {
    let page: URL;
    try { page = new URL(url.searchParams.get("url") ?? ""); } catch { return notFound(); }
    const id = page.origin === url.origin ? page.pathname.match(new RegExp(`^/d/(${idPattern})$`))?.[1] : undefined;
    const row = id ? await readDiagram(env, id, page.searchParams.get("token")) : null;
    return row ? json(await oembed(page, row)) : notFound();
  }
  const preview = pathname.match(new RegExp(`^/d/(${idPattern})/og\\.png$`));
  if (preview && (method === "GET" || method === "HEAD")) {
    const row = await readDiagram(env, preview[1], url.searchParams.get("token"));
    return row ? previewImage(env, url.origin, row, ctx) : notFound();
  }
  if (pathname.startsWith("/api/") || pathname.startsWith("/d/")) return notFound();
  if (method !== "GET" && method !== "HEAD") return json({ error: "Method not allowed" }, 405);
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    let response: Response;
    try { response = await route(request, env, ctx); }
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
    return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
