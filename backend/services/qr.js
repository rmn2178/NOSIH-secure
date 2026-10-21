/**
 * QR generation — PNG with the Land ID printed under the code.
 * The QR encodes the public verify URL for the parcel.
 */

import QRCode from "qrcode";
import sharp from "sharp";

const QR_SIZE = 480;
const LABEL_HEIGHT = 84;

export function buildVerifyUrl(landId) {
  const base = process.env.VERIFY_BASE_URL || "http://localhost:3000/verify";
  return `${base}?landId=${encodeURIComponent(landId)}`;
}

const escapeXml = (s) => String(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * @returns {{ verifyUrl: string, qrDataUrl: string, png: Buffer }}
 */
export async function generateLandQr(landId) {
  const verifyUrl = buildVerifyUrl(landId);
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
