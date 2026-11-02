/**
 * Aligns every box diagram in the README.
 *
 * A box is a run of lines that starts with ┌…┐ and ends with └…┘ at the same
 * indent. Each line inside is re-padded so the right border lands on one
 * column. A border may carry a title, which is preserved and re-centred.
 * Content is never trimmed — a box that is too narrow grows instead.
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = process.argv[2] || "README.md";
const lines = readFileSync(FILE, "utf8").split(/\r?\n/);

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

const padTo = (text, target) => {
  const w = width(text);
  return w >= target ? text : text + " ".repeat(target - w);
};

/** The title inside a border, if it has one. */
const titleOf = (between) => {
  const m = between.match(/^─*(.*?)─*$/);
  return m && m[1].trim() ? m[1] : "";
};

/** Rebuilds a border of the given inner width, keeping any title centred. */
function border(left, right, inner, title) {
  if (!title) return left + "─".repeat(inner) + right;
  const t = width(title);
  const room = Math.max(0, inner - t);
  const l = Math.floor(room / 2);
  return left + "─".repeat(l) + title + "─".repeat(room - l) + right;
}

let changed = 0;

for (let i = 0; i < lines.length; i++) {
  const top = lines[i].match(/^(\s*)┌(.*)┐\s*$/);
  if (!top) continue;
  const indent = top[1];
  const topTitle = titleOf(top[2]);
  let boxWidth = top[2].length + 2;

  // Find the closing border at the same indent.
  let end = -1;
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].match(/^\s*└.*┘\s*$/)) { end = j; break; }
  }
  if (end < 0) continue;

  // Collect the body and find its natural width.
  const body = [];
  for (let j = i + 1; j < end; j++) {
    const m = lines[j].match(/^(\s*)│(.*)$/);
    if (!m) continue;
    let content = m[2];
    if (content.endsWith("│")) content = content.slice(0, -1);
    body.push({ j, content });
  }

  const bottomTitle = titleOf((lines[end].match(/^\s*└(.*)┘\s*$/) || [, ""])[1]);

  // Grow the box to fit the widest content line and any titles.
  const needed = body.reduce((m, b) => Math.max(m, width(b.content) + 2), 0);
  const titleRoom = Math.max(width(topTitle), width(bottomTitle)) + 2;
  if (needed > boxWidth) boxWidth = needed;
  if (titleRoom > boxWidth) boxWidth = titleRoom;

  const inner = boxWidth - 2;
  const rebuilt = [];
  rebuilt.push(i, indent + border("┌", "┐", inner, topTitle));
  for (const b of body) rebuilt.push(b.j, `${indent}│${padTo(b.content, inner)}│`);
  rebuilt.push(end, indent + border("└", "┘", inner, bottomTitle));

  // Apply from the bottom up so earlier indices stay valid.
  // `rebuilt` holds [lineIndex, text] pairs: the index is even, the text odd.
  for (let k = rebuilt.length - 1; k >= 1; k -= 2) {
    const text = rebuilt[k];
    const lineIndex = rebuilt[k - 1];
    if (lines[lineIndex] !== text) {
      lines[lineIndex] = text;
      changed++;
    }
  }

  i = end;
}

writeFileSync(FILE, lines.join("\n"), "utf8");
console.log(`aligned ${changed} line(s) in ${FILE}`);
