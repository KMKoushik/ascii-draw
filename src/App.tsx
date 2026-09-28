import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button } from "./components/ui/button";
import { Panel } from "./components/ui/panel";
import { Textarea } from "./components/ui/textarea";
import { DiagramCanvas } from "./components/DiagramCanvas";
import { DrawEditor } from "./components/DrawEditor";
import { validateSpec, type Spec } from "../shared/spec";
import { savePng, saveText } from "./lib/render";
import example from "../shared/example.json";

type SharedDiagram = { id: string; title: string; spec: Spec; createdAt: string; expiresAt: string | null };
type Published = { url: string; raw: string; title: string };

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

function Header({ path }: { path: string }) {
  return <header className="header">
    <a href="/" className="wordmark" aria-label="Homepage"><span>[</span> diagram-link <span>]</span></a>
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

function Share() {
  const [raw, setRaw] = useState(starter);
  const [mode, setModeState] = useState<Mode>(readMode);
  const [title, setTitle] = useState(defaultTitle);
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<Published | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [, setHistoryVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const rawRef = useRef(raw);
  const history = useRef({ undo: [] as string[], redo: [] as string[], key: undefined as string | undefined, time: 0 });
  rawRef.current = raw;

  const deferred = useDeferredValue(raw);
  // Drawing needs the exact current state; the JSON preview can lag behind typing.
  const source = mode === "draw" ? raw : deferred;
  const parsed = useMemo(() => parse(source), [source]);
  const finalTitle = title.trim() || defaultTitle;
  const stale = !!published && (published.raw !== raw || published.title !== finalTitle);
  const canShare = !!parsed.value && source === raw && !busy && (!published || stale);

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

  async function share(event: FormEvent) {
    event.preventDefault();
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
      if (!response.ok || !result.url) throw new Error(result.error ?? "Couldn’t share. Try again.");
      setPublished({ url: result.url, raw, title: finalTitle });
      setCopied(await copy(result.url));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const status = parsed.value ? <span className="good">[ valid ]</span> : parsed.error ? <span className="bad">[ invalid ]</span> : null;
  const titleInput = <input name="title" aria-label="Title" maxLength={160} placeholder={defaultTitle} value={title} onChange={event => setTitle(event.target.value)} className="title-input" />;
  const shareBar = <form className="share-bar" onSubmit={share}>
    {published && !stale ? <>
      <input name="share-link" aria-label="Share link" readOnly value={published.url} onFocus={event => event.target.select()} className="link-input" />
      <a href={published.url} target="_blank" rel="noreferrer" className="link" aria-label="Open link in a new tab">Open ↗</a>
      <Button size="sm" className="primary" onClick={async () => setCopied(await copy(published.url))}>{copied ? "Copied ✓" : "Copy link"}</Button>
    </> : <Button type="submit" size="sm" className="primary" disabled={!canShare}>{busy ? "Sharing…" : stale ? "Share again →" : "Share →"}</Button>}
  </form>;
  const dropProps = {
    "data-dragging": dragging || undefined,
    onDragOver: (event: React.DragEvent) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } },
    onDragLeave: (event: React.DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); },
    onDrop: (event: React.DragEvent) => { if (!event.dataTransfer.files.length) return; event.preventDefault(); setDragging(false); void loadFile(event.dataTransfer.files[0]); },
  };

  return <>
    <div className="intro intro-row">
      <div className="intro">
        <h1>Share a diagram.</h1>
        <p className="lede">Draw it or paste the JSON. Share it. Copy the link.</p>
      </div>
      <div className="mode-tabs" role="group" aria-label="Editor">
        <button type="button" aria-pressed={mode === "draw"} onClick={() => setMode("draw")}>Draw</button>
        <button type="button" aria-pressed={mode === "json"} onClick={() => setMode("json")}>JSON</button>
      </div>
    </div>

    <input ref={fileInput} type="file" name="diagram" accept=".json,application/json" aria-label="Diagram JSON file" className="hidden" onChange={event => { void loadFile(event.target.files?.[0]); event.target.value = ""; }} />

    {mode === "draw" ? <div className="workspace single">
      <section className="pane draw-pane" aria-label="Drawing" {...dropProps}>
        <div className="pane-bar">
          {titleInput}
          {status}
          <span className="pane-actions">
            <button type="button" className="link" onClick={() => fileInput.current?.click()}>Upload ↑</button>
            <button type="button" className="link" disabled={!raw} onClick={() => replace("")}>Clear</button>
          </span>
          {shareBar}
        </div>
        {parsed.value || !raw.trim()
          ? <DrawEditor spec={parsed.value?.spec ?? null} diagram={parsed.value?.diagram ?? null} onCommit={commitDrawing} onUndo={undo} onRedo={redo} canUndo={history.current.undo.length > 0} canRedo={history.current.redo.length > 0} />
          : <div className="stage">
            <div className="draw-invalid">
              <p className="frame-error" role="alert">{parsed.error}</p>
              <button type="button" className="link" onClick={() => setMode("json")}>Fix it in JSON →</button>
            </div>
          </div>}
      </section>
    </div> : <div className="workspace">
      <section className="pane editor" aria-label="JSON" {...dropProps}>
        <div className="pane-bar">
          {titleInput}
          {status}
          <span className="pane-actions">
            <button type="button" className="link" onClick={() => fileInput.current?.click()}>Upload ↑</button>
            <button type="button" className="link" disabled={!parsed.value && !raw.trim()} onClick={format}>Format</button>
            <button type="button" className="link" disabled={!raw} onClick={() => { replace(""); setTitle(""); }}>Clear</button>
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
          {shareBar}
        </div>
        <div className="stage">
          {parsed.value
            ? <DiagramCanvas spec={parsed.value.spec} diagram={parsed.value.diagram} label={finalTitle} />
            : parsed.error
              ? <p className="frame-error" role="alert">{parsed.error}</p>
              : <p className="hint">Paste diagram JSON on the left.</p>}
        </div>
      </section>
    </div>}

    {error && <p className="error-text" role="alert">{error}</p>}
  </>;
}

function Viewer({ id }: { id: string }) {
  const [diagram, setDiagram] = useState<SharedDiagram | null>(null);
  const [error, setError] = useState("");
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);
  const token = new URLSearchParams(location.search).get("token");

  useEffect(() => {
    if (!token) { setError("Open the complete link, including its token."); return; }
    const controller = new AbortController();
    fetch(`/api/diagrams/${id}?token=${encodeURIComponent(token)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("This link is invalid, expired, or revoked. Ask the sender for a new one.");
        const result = await response.json() as SharedDiagram;
        setDiagram(result);
        document.title = `${result.title} · diagram-link`;
      })
      .catch(error => { if (error.name !== "AbortError") setError(error.message); });
    return () => { controller.abort(); document.title = "diagram-link"; };
  }, [id, token]);

  const value = useMemo(() => {
    if (!diagram) return null;
    try { return validateSpec(diagram.spec); } catch { return null; }
  }, [diagram]);

  if (error) return <div className="locked">
    <Panel title="Private diagram" tone="yellow" className="locked-panel">
      <p className="lock-mark" aria-hidden="true">[ × ]</p>
      <h1>You need the full link.</h1>
      <p className="lede">{error}</p>
    </Panel>
  </div>;
  if (!diagram) return <p className="loading" role="status">[ checking access… ]</p>;

  const filename = fileName(diagram.title);
  const created = new Date(diagram.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" });
  const expires = diagram.expiresAt ? ` · Expires ${new Date(diagram.expiresAt).toLocaleDateString(undefined, { dateStyle: "medium" })}` : "";

  return <>
    <div className="viewer-head">
      <div className="intro">
        <h1>{diagram.title}</h1>
        <p className="lede">Shared {created}{expires}</p>
      </div>
      <div className="actions">
        <button type="button" className="link" onClick={async () => setCopied(await copy(location.href))}>{copied ? "Copied ✓" : "Copy link"}</button>
        <Button className="primary" disabled={!canvas} onClick={() => canvas && void savePng(canvas, `${filename}.png`)}>Download PNG ↓</Button>
      </div>
    </div>
    <div className="stage framed">
      {value
        ? <DiagramCanvas spec={value.spec} diagram={value.diagram} label={diagram.title} onReady={setCanvas} />
        : <p className="frame-error" role="alert">This diagram can’t be rendered.</p>}
    </div>
    <div className="viewer-foot">
      <button type="button" className="link" onClick={() => saveText(JSON.stringify(diagram.spec, null, 2) + "\n", `${filename}.json`, "application/json")}>Download JSON ↓</button>
      {!!value?.diagram.icons.length && <a href="/licenses/TABLER-ICONS-LICENSE.txt" download>Icon license ↓</a>}
    </div>
  </>;
}

function Docs() {
  const origin = location.origin;
  useEffect(() => { document.title = "API · diagram-link"; return () => { document.title = "diagram-link"; }; }, []);
  return <article className="docs">
    <div className="intro">
      <h1>API</h1>
      <p className="lede">Publish diagrams from scripts and agents.</p>
    </div>

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
  const page = shared ? <Viewer id={shared[1]} /> : docs ? <Docs /> : <Share />;

  return <div className="app isolate">
    <Header path={path} />
    <main className={docs ? undefined : "wide"}>{page}</main>
    <footer className="footer"><span>[ diagram-link ]</span></footer>
  </div>;
}
