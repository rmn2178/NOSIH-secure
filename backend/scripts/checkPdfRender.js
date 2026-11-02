/**
 * Checks the PDF → image render path used for scanned deeds.
 *
 * The AI extractor falls back to Gemini vision for a PDF with no text layer.
 * That path renders pages through PDF.js, which needs its worker file. On a
 * serverless deployment the worker is not always packaged, and the failure
 * only shows up as "Setting up fake worker failed" in production.
 *
 * This script renders a generated one-page PDF the same way the service does,
 * so the failure is caught before it is deployed.
 *
 *   node backend/scripts/checkPdfRender.js
 */
import { writeFileSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

/** Builds a minimal but valid one-page PDF with a text layer. */
function buildPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] " +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = "BT /F1 24 Tf 30 100 Td (NOSIH render check) Tj ET";
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);

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

  return Buffer.from(body, "latin1");
}

/**
 * The same worker priming the service does.
 *
 * PDF.js imports its worker with a bundler-ignore hint, so the deployment
 * leaves the file out unless something imports it by name. This import is
 * what puts it in the bundle.
 *
 * The worker must not be handed to PDF.js by hand: pdf-parse bundles its own
 * copy of PDF.js and refuses a worker from a different version.
 */
async function primePdfWorker() {
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  return worker;
}

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "nosih-pdf-"));
  const file = path.join(dir, "check.pdf");
  writeFileSync(file, buildPdf());

  console.log("PDF render check");
  console.log(`  file        : ${file}`);
  console.log(`  node        : ${process.version}`);
  console.log("");

  try {
    await primePdfWorker();
    console.log("  PASS  the PDF.js worker file is present and loadable");
  } catch (err) {
    console.log(`  FAIL  the PDF.js worker could not be loaded — ${err.message}`);
    console.log("");
    console.log("  A deployment without this file fails every extraction with");
    console.log("  \"Setting up fake worker failed\".");
    process.exit(1);
  }

  // The scanned path: render the page to an image.
  let pdfToPng;
  try {
    const mod = await import("pdf-to-png-converter");
    pdfToPng = mod.pdfToPng;
  } catch (err) {
    console.log(`  FAIL  pdf-to-png-converter could not be loaded — ${err.message}`);
    process.exit(1);
  }

  try {
    const pages = await pdfToPng(file, { viewportScale: 2.0, pagesToProcess: [1] });
    const page = pages[0];
    if (!page || !page.content || !page.content.length) {
      console.log("  FAIL  the page rendered with no content");
      process.exit(1);
    }
    console.log(`  PASS  page 1 rendered — ${page.content.length} bytes of PNG`);
  } catch (err) {
    console.log(`  FAIL  PDF.js could not start — ${err.message}`);
    console.log("");
    console.log("  This is the failure a deployment hits when the PDF.js worker");
    console.log("  file is not packaged with the function.");
    process.exit(1);
  }

  // The digital path: read the text layer.
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: readFileSync(file) });
    const parsed = await parser.getText();
    const text = (parsed.text || "").trim();
    await parser.destroy();
    if (!text) {
      console.log("  FAIL  the text layer came back empty");
      process.exit(1);
    }
    console.log(`  PASS  text layer read — ${text.length} characters`);
  } catch (err) {
    console.log(`  FAIL  pdf-parse could not start — ${err.message}`);
    process.exit(1);
  }
}

main();
