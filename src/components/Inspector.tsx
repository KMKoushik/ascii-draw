import { useEffect, useMemo, useRef, useState } from "react";
import type { Spec } from "../../shared/spec";
import type { ElementRef } from "../../shared/geometry";
import { iconPreview, searchIcons } from "../lib/icons";

type Props = {
  spec: Spec;
  selection: ElementRef;
  focusField: string | null;
  onFocused: () => void;
  onChange: (next: Spec, mergeKey: string) => boolean;
  onDelete: () => void;
  onSelect: (ref: ElementRef) => void;
  onIconChosen: (id: string) => void;
};

type Path = NonNullable<Spec["connectors"]>[number];
const ports = ["top", "right", "bottom", "left"] as const;
const kindLabel = { box: "Box", text: "Text", icon: "Icon", connector: "Arrow", line: "Line", arrow: "Arrowhead" };

export function Inspector({ spec, selection, focusField, onFocused, onChange, onDelete, onSelect, onIconChosen }: Props) {
  const { kind, index } = selection;
  const key = `${kind}:${index}`;
  const edit = (field: string, mutate: (draft: Spec) => void) => {
    const next = structuredClone(spec);
    mutate(next);
    return onChange(next, `${key}:${field}`);
  };

  return <div className="draw-inspector" aria-label={`${kindLabel[kind]} properties`}>
    <div className="inspector-head">
      <span>{kindLabel[kind]}</span>
      <button type="button" className="link danger" onClick={onDelete}>Delete</button>
    </div>
    {kind === "box" && <BoxFields spec={spec} index={index} edit={edit} focusField={focusField} onFocused={onFocused} />}
    {kind === "icon" && <IconFields spec={spec} index={index} edit={edit} focusField={focusField} onFocused={onFocused} onIconChosen={onIconChosen} />}
    {(kind === "connector" || kind === "line") && <PathFields spec={spec} kind={kind} index={index} onChange={next => onChange(next, `${key}:path`)} onSelect={onSelect} />}
    {kind === "arrow" && <label className="inspector-field">
      <span>Direction</span>
      <select name="arrow-direction" value={spec.arrows![index].direction} onChange={event => edit("direction", draft => { draft.arrows![index].direction = event.target.value as "north"; })}>
        {["north", "east", "south", "west"].map(direction => <option key={direction} value={direction}>{direction}</option>)}
      </select>
    </label>}
  </div>;
}

type FieldProps = { spec: Spec; index: number; edit: (field: string, mutate: (draft: Spec) => void) => boolean; focusField: string | null; onFocused: () => void };

function BoxFields({ spec, index, edit }: FieldProps) {
  const box = spec.boxes![index];
  return <>
    <p className="hint">Double-click the box to type. Tab switches title and body.</p>
    <div className="inspector-field">
      <span>Align body</span>
      <div className="segmented" role="group" aria-label="Align body">
        {(["center", "left"] as const).map(align => <button key={align} type="button" aria-pressed={(box.align ?? "center") === align} onClick={() => edit("align", draft => { draft.boxes![index].align = align; })}>{align === "center" ? "Center" : "Left"}</button>)}
      </div>
    </div>
    <div className="inspector-field">
      <span>Align title</span>
      <div className="segmented" role="group" aria-label="Align title">
        {(["center", "left"] as const).map(align => <button key={align} type="button" aria-pressed={(box.titleAlign ?? "center") === align} onClick={() => edit("titleAlign", draft => { draft.boxes![index].titleAlign = align; })}>{align === "center" ? "Center" : "Left"}</button>)}
      </div>
    </div>
  </>;
}

function IconFields({ spec, index, edit, focusField, onFocused, onIconChosen }: FieldProps & { onIconChosen: (id: string) => void }) {
  const icon = spec.icons![index];
  const ref = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchIcons(query), [query]);
  useEffect(() => {
    if (focusField === "icon") { ref.current?.focus(); onFocused(); }
  }, [focusField, onFocused]);
  return <>
    <div className="inspector-current">
      <span className="icon-glyph" style={{ "--icon": `url(${iconPreview(icon.id)})` } as React.CSSProperties} aria-hidden="true" />
      <span>{icon.id}</span>
    </div>
    <label className="inspector-field">
      <span>Search icons</span>
      <input ref={ref} name="icon-search" value={query} placeholder="server, database, user…" onChange={event => setQuery(event.target.value)} />
    </label>
    <div className="icon-grid" role="listbox" aria-label="Icons">
      {results.map(option => <button key={option.id} type="button" role="option" aria-selected={option.id === icon.id} aria-label={option.id} title={option.id} onClick={() => {
        if (edit("id", draft => { draft.icons![index].id = option.id; })) onIconChosen(option.id);
      }}>
        <span className="icon-glyph" style={{ "--icon": `url(${option.preview})` } as React.CSSProperties} aria-hidden="true" />
      </button>)}
      {!results.length && <p className="hint">No icons match.</p>}
    </div>
  </>;
}

function PathFields({ spec, kind, index, onChange, onSelect }: { spec: Spec; kind: "connector" | "line"; index: number; onChange: (next: Spec) => boolean; onSelect: (ref: ElementRef) => void }) {
  const list = kind === "connector" ? spec.connectors! : spec.lines!;
  const path = list[index];
  const boxEnds = !!path.from && !!path.to && !Array.isArray(path.from) && !Array.isArray(path.to);
  const update = (mutate: (path: Path) => void) => {
    const next = structuredClone(spec);
    mutate((kind === "connector" ? next.connectors! : next.lines!)[index]);
    return onChange(next);
  };
  const toggleHead = () => {
    const next = structuredClone(spec);
    const [item] = (kind === "connector" ? next.connectors! : next.lines!).splice(index, 1);
    if (kind === "connector") {
      const { arrow: _arrow, arrowColor: _arrowColor, ...line } = item;
      next.lines = [...(next.lines ?? []), line];
      if (onChange(next)) onSelect({ kind: "line", index: next.lines.length - 1 });
    } else {
      next.connectors = [...(next.connectors ?? []), item];
      if (onChange(next)) onSelect({ kind: "connector", index: next.connectors.length - 1 });
    }
  };
  return <>
    <div className="inspector-field">
      <span>Arrowhead</span>
      <div className="segmented" role="group" aria-label="Arrowhead">
        <button type="button" aria-pressed={kind === "connector"} onClick={() => kind !== "connector" && toggleHead()}>On</button>
        <button type="button" aria-pressed={kind === "line"} onClick={() => kind !== "line" && toggleHead()}>Off</button>
      </div>
    </div>
    {boxEnds && !path.via?.length && <label className="inspector-field">
      <span>Route</span>
      <select name="route" value={path.route ?? "auto"} onChange={event => update(item => { if (event.target.value === "auto") delete item.route; else item.route = event.target.value as "horizontal-first"; })}>
        <option value="auto">Auto</option>
        <option value="horizontal-first">Horizontal first</option>
        <option value="vertical-first">Vertical first</option>
      </select>
    </label>}
    {boxEnds && <div className="inspector-pair">
      {(["from", "to"] as const).map(end => <label key={end} className="inspector-field">
        <span>{end === "from" ? "From side" : "To side"}</span>
        <select name={`${end}-port`} value={(path[end] as { port: string }).port} onChange={event => update(item => { item[end] = { box: (item[end] as { box: string }).box, port: event.target.value as "top" }; })}>
          {ports.map(port => <option key={port} value={port}>{port}</option>)}
        </select>
      </label>)}
    </div>}
  </>;
}
