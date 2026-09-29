# Diagram Composition

Use this guide before assigning coordinates. The layout must carry the explanation; icons and semantic colors must make its structure easier to read.

## Start with the claim

Write one sentence that the reader should remember. It is a design constraint, not diagram copy.

Then write the narrative spine as a short sequence:

```text
input → prepare → verify → use
```

Add only branches that change that story:

```text
verify → pass  → use
       → break → repair → verify
```

If the spine is hard to state, reduce the concepts before drawing.

## Make connections explicit

Before choosing coordinates, list the source, action, and target of each relationship. Distinguish calls, message flow, and storage access. Choose one main view and state the meaning of its arrows. Label edges when their actions differ or their meaning is not clear from the endpoints.

- Do not merge unrelated calls into a shared rail to save space. A junction implies a relationship. Use separate routes unless the source establishes a shared bus or equivalent flow.
- Place inputs that enter the same stage near that stage. Avoid routing an ordinary input around several boxes or back against the main reading direction.
- Connect storage to its known reader or writer. If the source establishes only process-level storage, show that scope and state that component ownership is unspecified; do not guess owners.
- Preserve uncertain source semantics in a short note. A visual revision must not silently become an architecture redesign.
- Explain project-specific terms when their meaning is known. Otherwise retain the name without inventing an expansion.
- Reserve room for edge labels before sizing the canvas. Reduce unused space before shrinking text. Judge readability at the size the user will see, not only when zoomed in.

## Allocate a text budget

A diagram is not a compressed design document. A paragraph split across boxes is still a paragraph.

- Use the title to name the component or action.
- Use zero to three short body lines for its essential state, input, or output.
- Give each line one idea.
- Use short labels and essential data instead of full explanatory sentences. Put the explanation outside the diagram. SQL fields and other requested structured data are valid node contents; prose disguised as a list is not.
- Delete a line if its removal does not change the reader's model.
- Put version keys, retry policy, race control, cache metadata, and similar details in a separate detail view unless they drive the primary flow.

Several separators usually mean that prose is hiding structure. Review lines that contain repeated `·`, `/`, commas, or arrows. The punctuation is not forbidden, but it must not replace boxes and connectors.

Dense:

```text
┌────────── PREPARE ──────────┐
│ checkout · patch · boot     │
│ replay · tools · trace      │
│ digest + contract + key     │
└─────────────────────────────┘
```

Structured:

```text
┌──── CHECKOUT ────┐
└─────────┬────────┘
          ▼
┌─── APPLY PATCHES ───┐
└──────────┬──────────┘
           ▼
┌──── SMOKE TEST ────┐
│ replay             │
│ tools              │
│ trace              │
└────────────────────┘
```

Use the structured form when the sequence matters. If the sequence does not matter, keep one box and remove the extra detail.

## Make hierarchy visible

- Put the common path on the main axis.
- Put rare work, recovery, and fallbacks on a side branch.
- Make containment a frame, not a sentence.
- Use arrows for order and causality. Do not repeat `then`, `next`, or `sends to` in body copy.
- Label branch outcomes near the split with terms that stand alone.
- Use lanes or groups for independent checks and frames for containment. Do not connect unrelated boxes merely to make the result look like a flowchart.
- Choose a relevant icon for each major node before reserving its space. Keep the icon recognizable at the final display size and pair it with a short title.

Semantic color is required in PNG output unless the user explicitly requests monochrome. It supports this hierarchy but does not replace it. A useful default is blue for inputs, violet for execution, green for success or reuse, amber for recovery or new work, teal for shared services or artifacts, and slate for containment. Select only the colors the diagram needs, and keep their meanings consistent. Preserve those meanings through labels and geometry in the plain-text version.

## Show continuity honestly

Separate boxes usually imply separate instances. When the same runtime or artifact continues:

- keep both phases inside one enclosing frame;
- connect them with a direct line labeled with the continuity only when necessary; or
- title the destination so identity is explicit, such as `SIMULATION IN THE SAME SANDBOX`.

Do not add an intermediate `promote`, `resolve`, or `prepare` box when the ordinary operation already produces the needed result. Show the operation and its outcome.

## Revise in passes

1. **Message pass:** Can a reader state the main claim after five seconds?
2. **Deletion pass:** Remove metadata, policy, and repeated explanation that do not change the claim.
3. **Structure pass:** Ignore body text. Can the icons, titles, connections, and groups still explain the main relationship? If not, replace the prose with steps, branches, containment, or a clearer comparison. Avoid creating a separate node for every phrase.
4. **Identity pass:** Check whether the geometry implies accidental recreation, copying, or ownership.
5. **Route pass:** Make the common path direct; move exceptions aside; give every arrow a clean final stem.
6. **Render pass:** Inspect the PNG at fit-to-view size and original detail. Require visible, recognizable icons, a meaningful color hierarchy, readable labels, and balanced spacing. The reader must not need to zoom in and read every box to understand the point.

If a tall diagram is hard to inspect, use temporary crops for QA. Do not ship the crops unless the user asks for them.

## Scope the deliverable

Follow the default deliverables and explicit format restrictions in [SKILL.md](../SKILL.md). A single PNG does not need responsive layouts, mobile variants, HTML, or alternate themes. Keep the editable JSON and text artifacts because they support revision. Use the renderer, font, and icon assets in place; do not copy skill-owned tools into the output directory unless the user asks for a portable bundle.
