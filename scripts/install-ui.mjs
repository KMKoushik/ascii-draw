import { mkdir, writeFile } from "node:fs/promises";
await mkdir("src/components/ui", { recursive: true });
for (const name of ["button", "panel", "input", "textarea"]) {
  const response = await fetch(`https://ascii.kdawg.dev/r/${name}.json`);
  if (!response.ok) throw new Error(`Cannot fetch ascii-cn ${name}`);
  const registry = await response.json();
  for (const file of registry.files) {
    // Adapt component sizing/focus to this compact application.
    let content = file.content.replaceAll("transition-colors ", "")
      .replaceAll("focus-visible:outline-offset-4", "focus-visible:-outline-offset-1")
      .replaceAll("h-11", "h-9");
    if (name === "button") content = content.replace('className,\n', 'className,\n  type = "button",\n').replace('<ButtonPrimitive\n', '<ButtonPrimitive\n      type={type}\n');
    await writeFile(`src/components/ui/${file.path}`, `// Adapted from https://ascii.kdawg.dev/r/${name}.json\n${content}`);
  }
}
