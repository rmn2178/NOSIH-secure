/**
 * Deed fixtures for the extraction checks.
 *
 * One builder, shared by every check that needs a PDF. Three copies of this
 * code is how they drift: an earlier version laid the text out beyond the page
 * MediaBox, and PDF.js — which only extracts text inside it — silently returned
 * 91 of 603 characters. The check passed while reading almost nothing.
 *
 * Both fixtures state the same deed, so a field assertion means the same thing
 * whichever path read it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, "..", "..", "backend");
const backendRequire = createRequire(path.join(BACKEND, "package.json"));

/** What both fixtures say. The assertions read this, not a second copy. */
export const DEED_LINES = [
  "DEED OF SALE",
  "This deed of sale is made between the vendor and the purchaser.",
  "Survey Number 1963/3000, Village Malibu Nagar,",
  "Taluk Andheri, District Mumbai Suburban, State Maharashtra.",
  "Area 0.0450 acres. Document type Sale Deed.",
  "Registration number 1234/2026 dated 2026-11-01.",
  "Sub-Registrar Office Andheri (SRO-04), Mumbai.",
  "The vendor is Peter Parker and the purchaser is Zendaya.",
];

/** The values the model is expected to return for DEED_LINES. */
export const DEED_EXPECTED = {
  surveyNumber: "1963/3000",
  buyerName: "Zendaya",
  sellerName: "Peter Parker",
  areaUnit: "acres",
  village: "Malibu Nagar",
  taluk: "Andheri",
  district: "Mumbai Suburban",
  state: "Maharashtra",
  documentType: "Sale Deed",
  registrationNumber: "1234/2026",
  registrationDate: "2026-11-01",
};

/** The area DEED_LINES states, as a number. */
export const DEED_AREA = 0.045;

/**
 * Assembles a single-page PDF from its objects.
 *
 * The cross-reference table is written by hand so the fixture has no
 * dependency on a PDF library — a check that builds its own input with the
 * same machinery it is testing proves nothing.
 */
function assemblePdf(objects) {
  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return body;
}

/**
 * A digital deed: real text in a text layer, no images.
 *
 * The page is 700pt tall and each line gets its own text-showing operation, so
 * every line lands inside the MediaBox and PDF.js can read all of it.
 */
export function buildTextDeed(outFile, lines = DEED_LINES) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 220] " +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  const parts = ["BT /F1 10 Tf 20 190 Td 14 TL"];
  lines.forEach((line, i) => {
    if (i > 0) parts.push("T*");
    parts.push(`(${line}) Tj`);
  });
  parts.push("ET");
  const stream = parts.join("\n");
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);

  fs.writeFileSync(outFile, Buffer.from(assemblePdf(objects), "latin1"));
  return outFile;
}

/**
 * A scanned deed: one page holding a JPEG, no text layer at all.
 *
 * This is the shape that sends the extractor down the local-OCR path. The
 * canvas draws the same lines the digital fixture states, so the two are
 * comparable field for field.
 */
export function buildScannedDeed(outFile, lines = DEED_LINES) {
  const { createCanvas } = backendRequire("@napi-rs/canvas");
  const canvas = createCanvas(1240, 1754);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1240, 1754);
  ctx.fillStyle = "#111111";
  ctx.font = "bold 44px Helvetica";
  ctx.fillText(lines[0], 90, 150);
  ctx.font = "28px Helvetica";
  lines.slice(1).forEach((line, i) => ctx.fillText(line, 90, 260 + i * 60));
  const jpeg = canvas.toBuffer("image/jpeg", 90);

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 620 877] " +
      "/Resources << /XObject << /Im0 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Type /XObject /Subtype /Image /Width 1240 /Height 1754 ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\n` +
      `stream\n${jpeg.toString("binary")}\nendstream`,
    "<< /Length 44 >>\nstream\nq 620 0 0 877 0 0 cm /Im0 Do Q\nendstream",
  ];

  fs.writeFileSync(outFile, Buffer.from(assemblePdf(objects), "binary"));
  return outFile;
}