#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const [file, title, expiresAt] = process.argv.slice(2);
if (!file || !title) {
  console.error('Usage: node scripts/publish.mjs diagram.json "Diagram title" [expiry-ISO8601]');
  process.exit(1);
}
const origin = process.env.DIAGRAM_LINK_ORIGIN;
if (!origin) {
  console.error("Set DIAGRAM_LINK_ORIGIN, e.g. https://ascii.kdawg.dev");
  process.exit(1);
}
try {
  const spec = JSON.parse(await readFile(file, "utf8"));
  const response = await fetch(new URL("/api/diagrams", origin), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, spec, ...(expiresAt ? { expiresAt } : {}) }),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${result.error ?? "Publishing failed"}`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
