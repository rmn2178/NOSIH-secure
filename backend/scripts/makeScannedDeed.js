/**
 * Builds a scanned-style deed PDF: one page holding a JPEG image and no text
 * layer. It is the shape of PDF that sends the extractor down the Gemini
 * vision path.
 */
import { writeFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// ── Render the page as an image ──────────────────────────
const { createCanvas } = require("@napi-rs/canvas");
const canvas = createCanvas(1240, 1754);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#ffffff";
ctx.fillRect(0, 0, 1240, 1754);
ctx.fillStyle = "#111111";
ctx.font = "bold 44px Helvetica";
ctx.fillText("DEED OF SALE", 90, 150);
ctx.font = "28px Helvetica";
const lines = [
  "This deed of sale is made between the vendor and the purchaser.",
  "Survey Number 1963/3000, Village Malibu Nagar,",
  "Taluk Andheri, District Mumbai Suburban, State Maharashtra.",
  "Area 0.0450 acres. Document type Sale Deed.",
  "Registration number 1234/2026 dated 2026-11-01.",
  "Sub-Registrar Office Andheri (SRO-04), Mumbai.",
];
lines.forEach((line, i) => ctx.fillText(line, 90, 260 + i * 60));
const jpeg = canvas.toBuffer("image/jpeg", 90);

// ── Wrap it in a PDF with no text layer ──────────────────
const objects = [];
objects.push("<< /Type /Catalog /Pages 2 0 R >>");
objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
objects.push(
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
    "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>"
);
objects.push(
  `<< /Type /XObject /Subtype /Image /Width 1240 /Height 1754 ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\n` +
    `stream\n${jpeg.toString("binary")}\nendstream`
);
const content = "q 595 0 0 842 0 0 cm /Im0 Do Q";
objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

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

writeFileSync(process.argv[2] || "deed-scanned.pdf", Buffer.from(body, "binary"));
console.log("wrote", process.argv[2] || "deed-scanned.pdf", jpeg.length, "bytes of JPEG");
