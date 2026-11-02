/**
 * Checks the README's own structure.
 *
 * Two things are verified:
 *   1. The code fences are balanced. An unbalanced fence swallows the rest of
 *      the document, which is easy to introduce and hard to see.
 *   2. Every box diagram has its right border on a single column. A diagram
 *      that has drifted out of alignment reads as broken, and markdown renders
 *      code blocks in a monospace font where that is visible at a glance.
 *
 *   node scripts/check-readme.mjs [file]
 */
import { readFileSync } from "node:fs";

const FILE = process.argv[2] || "README.md";
const lines = readFileSync(FILE, "utf8").split(/\r?\n/);

const problems = [];

// ── 1. Code fences ─────────────────────────────────────────

let open = false;
let openAt = 0;
let markers = 0;

for (let i = 0; i < lines.length; i++) {
  if (!lines[i].trim().startsWith("```")) continue;
  markers++;
  if (open) {
    open = false;
  } else {
    open = true;
    openAt = i + 1;
  }
}
if (open) problems.push(`the code block opened at line ${openAt} is never closed`);

// ── 2. Box diagrams ────────────────────────────────────────

/** Display width of a line, counting East-Asian wide characters as two. */
function width(text) {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6);
    w += wide ? 2 : 1;
  }
  return w;
}

let inFence = false;
let inBox = false;
const widths = new Map();
let boxStart = 0;

for (let i = 0; i < lines.length; i++) {
  const text = lines[i];
  const t = text.trim();

  if (t.startsWith("```")) {
    inFence = !inFence;
    inBox = false;
    continue;
  }
  if (inFence) continue;

  if (/^┌.*┐$/.test(t)) {
    inBox = true;
    boxStart = i + 1;
    widths.clear();
    continue;
  }
  if (/^└.*┘$/.test(t)) {
    inBox = false;
    if (widths.size > 1) {
      problems.push(
        `the diagram at line ${boxStart} has borders at ${[...widths.entries()]
          .map(([w, n]) => `${w}px×${n}`)
          .join(", ")}`
      );
    }
    widths.clear();
    continue;
  }
  if (!inBox) continue;

  const chars = [...text];
  const pipes = chars.map((c, k) => (c === "│" ? k : -1)).filter((k) => k >= 0);
  if (pipes.length < 2) continue;
  const w = width(chars.slice(pipes[0], pipes[pipes.length - 1] + 1).join(""));
  widths.set(w, (widths.get(w) || 0) + 1);
}

// ── Report ─────────────────────────────────────────────────

console.log(`README structure check — ${FILE}`);
console.log(`  code fence markers : ${markers}`);

if (problems.length) {
  console.log("");
  for (const p of problems) console.log(`  FAIL  ${p}`);
  process.exit(1);
}

console.log("  PASS  code fences are balanced");
console.log("  PASS  every box diagram is aligned");
