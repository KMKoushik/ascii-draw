import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button } from "./components/ui/button";
import { Panel } from "./components/ui/panel";
import { Textarea } from "./components/ui/textarea";
import { DiagramCanvas } from "./components/DiagramCanvas";
import { DrawEditor } from "./components/DrawEditor";
import { validateSpec, type Spec } from "../shared/spec";
import { renderCanvas, savePng } from "./lib/render";
import example from "../shared/example.json";

type SharedDiagram = { id: string; title: string; spec: Spec; createdAt: string; expiresAt: string | null };

const maxFileBytes = 250 * 1024;
const starter = JSON.stringify(example, null, 2);
const defaultTitle = "Architecture";

function parse(raw: string) {
  if (!raw.trim()) return { value: null, error: "" };
  try { return { value: validateSpec(JSON.parse(raw)), error: "" }; }
  catch (error) { return { value: null, error: error instanceof SyntaxError ? `Invalid JSON: ${error.message}` : (error as Error).message }; }
}
function titleFrom(name: string) {
  return name.replace(/\.json$/i, "").replace(/[-_]+/g, " ").trim().slice(0, 160);
}
function fileName(title: string) {
  return title.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80) || "diagram";
}
async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function Wordmark() {
  return <a href="/" className="wordmark" aria-label="Homepage"><span>[</span> ascii-diagram <span>]</span></a>;
}

function Header({ path }: { path: string }) {
  return <header className="header">
    <Wordmark />
    <nav aria-label="Main" className="nav">
      <a href="/" aria-current={path === "/" ? "page" : undefined}>Share</a>
      <a href="/docs" aria-current={path === "/docs" ? "page" : undefined}>API</a>
    </nav>
  </header>;
}

type Mode = "draw" | "json";
const modeStorage = "diagram-link:mode";
function readMode(): Mode {
  try { return localStorage.getItem(modeStorage) === "json" ? "json" : "draw"; } catch { return "draw"; }
}

type Linked = { id: string; token: string; url: string };
type SaveState = "saved" | "saving" | "pending" | "invalid" | "error";
type Snapshot = { raw: string; title: string };

function linkFrom(url: string): Linked | null {
  try {
    const parsed = new URL(url);
    const id = parsed.pathname.match(/^\/d\/([a-f0-9-]{36})$/)?.[1];
    const token = parsed.searchParams.get("token");
    return id && token ? { id, token, url: parsed.href } : null;
  } catch { return null; }
}

function Editor({ doc }: { doc?: SharedDiagram & { token: string } }) {
  const initialRaw = doc ? JSON.stringify(doc.spec, null, 2) : starter;
  const initialTitle = doc?.title ?? defaultTitle;
  const [raw, setRaw] = useState(initialRaw);
  const [mode, setModeState] = useState<Mode>(readMode);
  const [title, setTitle] = useState(initialTitle);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<Linked | null>(doc ? { id: doc.id, token: doc.token, url: location.href } : null);
  const [saved, setSaved] = useState<Snapshot | null>(doc ? { raw: initialRaw, title: initialTitle } : null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [retry, setRetry] = useState(0);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [, setHistoryVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const rawRef = useRef(raw);
  const saving = useRef(false);
  const history = useRef({ undo: [] as string[], redo: [] as string[], key: undefined as string | undefined, time: 0 });
  rawRef.current = raw;

  const deferred = useDeferredValue(raw);
  // Drawing needs the exact current state; the JSON preview can lag behind typing.
  const source = mode === "draw" ? raw : deferred;
  const parsed = useMemo(() => parse(source), [source]);
  const finalTitle = title.trim() || defaultTitle;
  const dirty = !!link && (!saved || saved.raw !== raw || saved.title !== finalTitle);
  const canShare = !!parsed.value && source === raw && !busy && !link;

  useEffect(() => { document.title = link ? `${finalTitle} · ascii-diagram` : "ascii-diagram"; }, [link, finalTitle]);

  function setMode(next: Mode) {
    setModeState(next);
    try { localStorage.setItem(modeStorage, next); } catch { /* storage unavailable */ }
  }

  const replace = useCallback((next: string, mergeKey?: string) => {
    const current = rawRef.current;
    if (next === current) return;
    const h = history.current;
    const now = Date.now();
    if (!(mergeKey && h.key === mergeKey && now - h.time < 1500)) h.undo.push(current);
    if (h.undo.length > 200) h.undo.shift();
    h.redo = [];
    h.key = mergeKey;
    h.time = now;
    rawRef.current = next;
    setRaw(next);
    setHistoryVersion(version => version + 1);
  }, []);

  const commitDrawing = useCallback((spec: Spec | null, mergeKey?: string) => {
    replace(spec ? JSON.stringify(spec, null, 2) : "", mergeKey);
  }, [replace]);

  const step = useCallback((from: "undo" | "redo") => {
    const h = history.current;
    const next = h[from].pop();
    if (next === undefined) return;
    h[from === "undo" ? "redo" : "undo"].push(rawRef.current);
    h.key = undefined;
    rawRef.current = next;
    setRaw(next);
    setHistoryVersion(version => version + 1);
  }, []);
  const undo = useCallback(() => step("undo"), [step]);
  const redo = useCallback(() => step("redo"), [step]);

  // Linked diagrams autosave: the link always shows the latest valid version.
  useEffect(() => {
    if (!link) return;
    if (!dirty) { setSaveState(state => state === "error" ? state : "saved"); return; }
    if (!parsed.value || source !== raw) { setSaveState(parsed.value ? "pending" : "invalid"); return; }
    setSaveState("pending");
    const snapshot = { raw, title: finalTitle };
    const spec = parsed.value.spec;
    const timer = setTimeout(async () => {
      if (saving.current) { setRetry(n => n + 1); return; }
      saving.current = true;
      setSaveState("saving");
      try {
        const response = await fetch(`/api/diagrams/${link.id}?token=${encodeURIComponent(link.token)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: snapshot.title, spec }),
        });
        if (response.status === 429) { setSaveState("error"); setTimeout(() => setRetry(n => n + 1), 5000); return; }
        if (!response.ok) {
          const result = await response.json().catch(() => ({})) as { error?: string };
          setSaveState("error");
          setError(response.status === 404 ? "This link no longer accepts edits (expired or revoked). Share again for a new link." : result.error ?? "Couldn’t save. Retrying…");
          if (response.status !== 404) setTimeout(() => setRetry(n => n + 1), 5000);
          return;
        }
        setError("");
        setSaved(snapshot);
      } catch {
        setSaveState("error");
        setTimeout(() => setRetry(n => n + 1), 5000);
      } finally {
        saving.current = false;
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [link, dirty, parsed, source, raw, finalTitle, retry]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (mode !== "draw") return;
    function onPaste(event: ClipboardEvent) {
      if ((event.target as HTMLElement | null)?.closest?.("input, textarea")) return;
      const text = event.clipboardData?.getData("text/plain").trim();
      if (!text?.startsWith("{")) return;
      event.preventDefault();
      if (text.length > maxFileBytes) { setError("Pasted JSON must be under 250 KB."); return; }
      replace(text);
      setError("");
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [mode, replace]);

  async function loadFile(file?: File) {
    if (!file) return;
    if (file.size > maxFileBytes) { setError("Choose a JSON file under 250 KB."); return; }
    try {
      replace(await file.text());
      setTitle(titleFrom(file.name));
      setError("");
    } catch { setError("Couldn’t read that file."); }
  }

  function format() {
    try { replace(JSON.stringify(JSON.parse(raw), null, 2)); } catch { /* button is disabled for invalid JSON */ }
  }

  async function downloadPng() {
    if (!parsed.value) return;
    try { await savePng(await renderCanvas(parsed.value.spec, parsed.value.diagram), `${fileName(finalTitle)}.png`); }
    catch (error) { setError((error as Error).message); }
  }

  async function share(event: FormEvent) {
    event.preventDefault();
    if (link) { setCopied(await copy(link.url)); return; }
    if (!canShare || !parsed.value) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/diagrams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: finalTitle, spec: parsed.value.spec }),
      });
      const result = await response.json().catch(() => ({})) as { url?: string; error?: string };
      if (response.status === 429) throw new Error("Too many shares from this network. Try again in a minute.");
      const created = result.url ? linkFrom(result.url) : null;
      if (!response.ok || !created) throw new Error(result.error ?? "Couldn’t share. Try again.");
      // From here on this page is the diagram's link, and edits save to it.
      history.current.key = undefined;
      window.history.replaceState(null, "", created.url);
      setLink(created);
      setSaved({ raw, title: finalTitle });
      setCopied(await copy(created.url));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const status = parsed.value ? <span className="good">[ valid ]</span> : parsed.error ? <span className="bad">[ invalid ]</span> : null;
  // Derived so the label never claims "Saved" in the moment before a save starts.
  const shownState: SaveState = dirty && saveState === "saved" ? (parsed.value ? "pending" : "invalid") : !dirty && saveState !== "error" ? "saved" : saveState;
  const saveLabel = { saved: "Saved", saving: "Saving…", pending: "Unsaved changes", invalid: "Not saved: fix errors", error: "Couldn’t save" }[shownState];
  const titleInput = <input name="title" aria-label="Title" maxLength={160} placeholder={defaultTitle} value={title} onChange={event => setTitle(event.target.value)} className="title-input" />;
  const shareBar = <form className="share-bar" onSubmit={share}>
    {link ? <>
      <span className={`save-state ${shownState}`} role="status" aria-label="Save status">{saveLabel}</span>
      <input name="share-link" aria-label="Share link" readOnly value={link.url} onFocus={event => event.target.select()} className="link-input" />
      <Button type="submit" size="sm" className="primary">{copied ? "Copied ✓" : "Copy link"}</Button>
    </> : <Button type="submit" size="sm" className="primary" disabled={!canShare}>{busy ? "Sharing…" : "Share →"}</Button>}
  </form>;
  const dropProps = {
    "data-dragging": dragging || undefined,
    onDragOver: (event: React.DragEvent) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } },
    onDragLeave: (event: React.DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); },
    onDrop: (event: React.DragEvent) => { if (!event.dataTransfer.files.length) return; event.preventDefault(); setDragging(false); void loadFile(event.dataTransfer.files[0]); },
  };

  return <div className="editor-app isolate">
    <header className="topbar">
      <div className="topbar-start">
        <Wordmark />
        <span className="topbar-divider" aria-hidden="true" />
        <div className="topbar-doc">
          {titleInput}
          {status}
        </div>
      </div>
      <div className="mode-tabs" role="group" aria-label="Editor">
        <button type="button" aria-pressed={mode === "draw"} onClick={() => setMode("draw")}>Draw</button>
        <button type="button" aria-pressed={mode === "json"} onClick={() => setMode("json")}>JSON</button>
      </div>
      <div className="topbar-actions">
        {link && <a href="/" className="link" title="Start a new diagram">New</a>}
        <button type="button" className="link" onClick={() => fileInput.current?.click()}>Upload ↑</button>
        <button type="button" className="link" disabled={!parsed.value} onClick={() => void downloadPng()}>PNG ↓</button>
        <button type="button" className="link" disabled={!raw} onClick={() => { replace(""); if (mode === "json") setTitle(""); }}>Clear</button>
        <a href="/docs" className="link">API</a>
        {shareBar}
      </div>
    </header>

    <input ref={fileInput} type="file" name="diagram" accept=".json,application/json" aria-label="Diagram JSON file" className="hidden" onChange={event => { void loadFile(event.target.files?.[0]); event.target.value = ""; }} />
    {error && <p className="error-text topbar-error" role="alert">{error}</p>}

    {mode === "draw" ? <main className="workspace single">
      <section className="pane draw-pane" aria-label="Drawing" {...dropProps}>
        {parsed.value || !raw.trim()
          ? <DrawEditor spec={parsed.value?.spec ?? null} diagram={parsed.value?.diagram ?? null} onCommit={commitDrawing} onUndo={undo} onRedo={redo} canUndo={history.current.undo.length > 0} canRedo={history.current.redo.length > 0} />
          : <div className="stage">
            <div className="draw-invalid">
              <p className="frame-error" role="alert">{parsed.error}</p>
              <button type="button" className="link" onClick={() => setMode("json")}>Fix it in JSON →</button>
            </div>
          </div>}
      </section>
    </main> : <main className="workspace">
      <section className="pane editor" aria-label="JSON" {...dropProps}>
        <div className="pane-bar">
          <span className="pane-title">JSON</span>
          <span className="pane-actions">
            <button type="button" className="link" disabled={!parsed.value && !raw.trim()} onClick={format}>Format</button>
          </span>
        </div>
        <Textarea
          name="spec"
          aria-label="Diagram JSON"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="Paste diagram JSON here"
          value={raw}
          onChange={event => { rawRef.current = event.target.value; setRaw(event.target.value); history.current.key = undefined; }}
          className="json-editor"
        />
      </section>

      <section className="pane" aria-label="Preview">
        <div className="pane-bar">
          <span className="pane-title">Preview</span>
          {parsed.value && <span className="dim">{parsed.value.spec.canvas.width} × {parsed.value.spec.canvas.height}</span>}
          {!!parsed.value?.diagram.icons.length && <a href="/licenses/TABLER-ICONS-LICENSE.txt" className="link push-end" download>Icon license ↓</a>}
        </div>
        <div className="stage">
          {parsed.value
            ? <DiagramCanvas spec={parsed.value.spec} diagram={parsed.value.diagram} label={finalTitle} />
            : parsed.error
              ? <p className="frame-error" role="alert">{parsed.error}</p>
              : <p className="hint">Paste diagram JSON on the left.</p>}
        </div>
      </section>
    </main>}
  </div>;
}

// A share link opens the editor on that diagram; edits save back to the same link.
function SharedEditor({ id }: { id: string }) {
  const [doc, setDoc] = useState<(SharedDiagram & { token: string }) | null>(null);
  const [error, setError] = useState("");
  const token = new URLSearchParams(location.search).get("token");

  useEffect(() => {
    if (!token) { setError("Open the complete link, including its token."); return; }
    const controller = new AbortController();
    fetch(`/api/diagrams/${id}?token=${encodeURIComponent(token)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("This link is invalid, expired, or revoked. Ask the sender for a new one.");
        setDoc({ ...(await response.json() as SharedDiagram), token });
      })
      .catch(error => { if (error.name !== "AbortError") setError(error.message); });
    return () => controller.abort();
  }, [id, token]);

  if (doc) return <Editor doc={doc} />;
  return <div className="app isolate">
    <Header path={location.pathname} />
    <main className="page">
      {error ? <div className="locked">
        <Panel title="Private diagram" tone="yellow" className="locked-panel">
          <p className="lock-mark" aria-hidden="true">[ × ]</p>
          <h1>You need the full link.</h1>
          <p className="lede">{error}</p>
        </Panel>
      </div> : <p className="loading" role="status">[ opening diagram… ]</p>}
    </main>
    <footer className="footer"><span>[ ascii-diagram ]</span></footer>
  </div>;
}

function Docs() {
  const origin = location.origin;
  useEffect(() => { document.title = "API · ascii-diagram"; return () => { document.title = "ascii-diagram"; }; }, []);
  return <article className="docs">
    <div className="intro">
      <h1>API</h1>
      <p className="lede">Publish diagrams from scripts and agents.</p>
    </div>

    <section>
      <h2><span>MCP</span> {origin}/mcp</h2>
      <p>Connect any MCP client (Streamable HTTP, no auth). Agents get an authoring guide, a renderer to check their work, and a publish tool that returns the private link.</p>
      <pre tabIndex={0}>{`# Claude Code
claude mcp add --transport http ascii-diagram ${origin}/mcp

# Cursor: ~/.cursor/mcp.json
{ "mcpServers": { "ascii-diagram": { "url": "${origin}/mcp" } } }

# OpenCode: opencode.json
{ "mcp": { "ascii-diagram": { "type": "remote", "url": "${origin}/mcp" } } }`}</pre>
      <p>Tools: <code>diagram_guide</code>, <code>render_diagram</code>, <code>publish_diagram</code>, <code>get_diagram</code>, <code>update_diagram</code>, <code>search_icons</code>. The guide and example specs are also available as resources, and there is a <code>draw_diagram</code> prompt.</p>
    </section>

    <section>
      <h2><span>POST</span> /api/diagrams</h2>
      <pre tabIndex={0}>{`curl ${origin}/api/diagrams \\
  -H "Content-Type: application/json" \\
  -d '{ "title": "System architecture", "spec": { … } }'`}</pre>
      <p><code>spec</code> is the diagram JSON. <code>title</code> is optional. Add <code>expiresAt</code> (ISO 8601) for a link that expires.</p>
      <pre tabIndex={0}>{`201 Created
{
  "id": "…",
  "url": "${origin}/d/…?token=…",
  "title": "System architecture",
  "createdAt": "…",
  "expiresAt": null
}`}</pre>
      <p>No auth needed. Send the complete <code>url</code>. The token in it is the only way to open the diagram. Limit: 30 shares per minute per IP.</p>
    </section>

    <section>
      <h2><span>PUT</span> /api/diagrams/:id?token=…</h2>
      <pre tabIndex={0}>{`curl -X PUT "${origin}/api/diagrams/…?token=…" \\
  -H "Content-Type: application/json" \\
  -d '{ "spec": { … } }'`}</pre>
      <p>Replaces the diagram's spec. The link stays the same and shows the new version. <code>title</code> is optional; omit it to keep the current one. Returns <code>200</code> with the same fields as publishing.</p>
      <p>Anyone with the full link can update. The editor autosaves this way when you open a link. A wrong, expired, or revoked token returns <code>404</code>. Limit: 120 updates per minute per IP.</p>
    </section>

    <section>
      <h2><span>POST</span> /api/diagrams/:id/rotate-token</h2>
      <p>Admin only. Returns a new URL; the old link stops working immediately.</p>
    </section>

    <section>
      <h2><span>POST</span> /api/diagrams/:id/revoke</h2>
      <p>Admin only. Disables the link immediately.</p>
    </section>

    <section className="docs-links">
      <a href="/agent.md">Agent instructions ↗</a>
      <a href="/spec-format.md">Spec format ↗</a>
    </section>
  </article>;
}

export default function App() {
  const path = location.pathname;
  const shared = path.match(/^\/d\/([a-f0-9-]{36})$/);
  const docs = path === "/docs";
  useEffect(() => { try { localStorage.removeItem("diagram-link:publish-key"); } catch { /* storage unavailable */ } }, []);
  if (shared) return <SharedEditor id={shared[1]} />;
  if (!docs) return <Editor />;

  return <div className="app isolate">
    <Header path={path} />
    <main className="page"><Docs /></main>
    <footer className="footer"><span>[ ascii-diagram ]</span></footer>
  </div>;
}
