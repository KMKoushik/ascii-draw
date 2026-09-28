import { useEffect, useRef, useState } from "react";
import { renderCanvas } from "../lib/render";
import type { Diagram } from "../../shared/engine.js";
import type { Spec } from "../../shared/spec";

type Props = { spec: Spec; diagram: Diagram; label: string; onReady?: (canvas: HTMLCanvasElement) => void };

export function DiagramCanvas({ spec, diagram, label, onReady }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ready = useRef(onReady);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  ready.current = onReady;

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    renderCanvas(spec, diagram)
      .then(canvas => {
        if (cancelled) return;
        host.current?.replaceChildren(canvas);
        setStatus("ready");
        ready.current?.(canvas);
      })
      .catch(error => {
        if (cancelled) return;
        setMessage(error.message);
        setStatus("error");
      });
    return () => { cancelled = true; };
  }, [spec, diagram]);

  return <div className="canvas-wrap">
    {status === "loading" && <p className="hint" role="status">Rendering…</p>}
    {status === "error" && <p className="frame-error" role="alert">{message}</p>}
    <div ref={host} role="img" aria-label={label} className="canvas-host" hidden={status !== "ready"} />
  </div>;
}
