/**
 * QR generation — PNG with the Land ID printed under the code.
 * The QR encodes the public verify URL for the parcel.
 */

import "../env.js"; // loads the repository-root .env — must come first
import QRCode from "qrcode";

// sharp is a native module. Loading it on first use keeps a platform-level
// binary problem from killing the whole function at import time — only QR
// generation would be affected.
let sharpPromise = null;
function getSharp() {
  if (!sharpPromise) sharpPromise = import("sharp").then((m) => m.default ?? m);
  return sharpPromise;
}

const QR_SIZE = 480;
const LABEL_HEIGHT = 84;

const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Public base URL for the verify page.
 *
 * Production (single Vercel domain): derived from the incoming request, so no
 * deployment-specific env var is needed. Locally the dev frontend runs on a
 * different port, so VERIFY_BASE_URL (localhost) wins there.
 */
export function verifyBaseFrom(req) {
  const configured = (process.env.VERIFY_BASE_URL || "").replace(/\/$/, "");
  const host = (req?.get?.("x-forwarded-host") || req?.get?.("host") || "").split(",")[0].trim();
  const proto = (req?.get?.("x-forwarded-proto") || req?.protocol || "https").split(",")[0].trim();

  if (configured) {
    const configuredIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(configured);
    if (!configuredIsLocal) return configured;
    if (LOCAL_HOST.test(host)) return configured;
  }

  if (host && !/^https?:\/\//.test(host)) return `${proto}://${host}/verify`;
  return configured || "http://localhost:3000/verify";
}

export function buildVerifyUrl(landId, req) {
  return `${verifyBaseFrom(req)}?landId=${encodeURIComponent(landId)}`;
}

const escapeXml = (s) => String(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * @returns {{ verifyUrl: string, qrDataUrl: string, png: Buffer }}
 */
export async function generateLandQr(landId, req) {
  const verifyUrl = buildVerifyUrl(landId, req);
  const qrPng = await QRCode.toBuffer(verifyUrl, {
    width: QR_SIZE,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#1E2126", light: "#FFFFFF" },
  });

  const label = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${QR_SIZE}" height="${LABEL_HEIGHT}">
      <rect width="100%" height="100%" fill="#FFFFFF"/>
      <text x="50%" y="34" text-anchor="middle" font-family="Consolas, 'Courier New', monospace"
            font-size="30" font-weight="700" fill="#1E2126">${escapeXml(landId)}</text>
      <text x="50%" y="64" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
            font-size="16" fill="#6B7079">NOSIH Land Registry · scan to verify</text>
    </svg>`
  );

  const sharp = await getSharp();
  const png = await sharp({
    create: { width: QR_SIZE, height: QR_SIZE + LABEL_HEIGHT, channels: 3, background: "#FFFFFF" },
  })
    .composite([
      { input: qrPng, top: 0, left: 0 },
      { input: label, top: QR_SIZE, left: 0 },
    ])
    .png()
    .toBuffer();

  return { verifyUrl, png, qrDataUrl: `data:image/png;base64,${png.toString("base64")}` };
}
