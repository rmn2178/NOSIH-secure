#!/usr/bin/env node
/**
 * Generates the brand-coloured SVG badge set used by README.md.
 *
 * Badges are committed as local assets (images/badges/*.svg) instead of remote
 * shields.io URLs so the README renders identically on GitHub, in offline
 * markdown previews, and in air-gapped environments.
 *
 * Run: node scripts/generate-badges.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'images', 'badges');

const FONT = "Verdana, 'DejaVu Sans', Geneva, sans-serif";

/** 24x24 viewBox icon paths (simple-icons / material style, single fill). */
const ICONS = {
  vercel: 'M12 0l12 21H0z',
  shield: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5z',
  cursor: 'M4 3l7.5 17 2.2-7.3L21 10.5z',
  play: 'M8 5v14l11-7z',
  doc: 'M6 2h8l4 4v16H6zM13 3v4h4z'
};

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * @param {object} spec
 * @param {'badge'|'flat'} spec.style  badge = 28px for-the-badge, flat = 20px flat-square
 * @param {string} spec.label
 * @param {string} spec.message
 * @param {string} spec.color   message-side hex (no #); label side is graphite #555
 * @param {string} [spec.text]  message/label text hex, default ffffff
 * @param {keyof typeof ICONS} [spec.icon]
 */
function badgeSvg({ style, label, message, color, icon, text = 'ffffff' }) {
  const big = style === 'badge';
  const h = big ? 28 : 20;
  const rx = big ? 6 : 0;
  const fs = big ? 11 : 10;
  const cwLabel = big ? 7.4 : 6.6; // forced via textLength, keeps boxes deterministic
  const cwMsg = big ? 6.6 : 5.9;
  const pad = big ? 10 : 8;

  const iconSize = 15;
  const iconY = Math.round((h - iconSize) / 2);
  const labelX = icon ? 27 : pad;

  const iconEl = icon
    ? `<path transform="translate(7,${iconY}) scale(${(iconSize / 24).toFixed(4)})" fill="#ffffff" d="${ICONS[icon]}"/>`
    : '';

  const labelTextLen = Math.round(label.length * cwLabel);
  const msgTextLen = Math.round(message.length * cwMsg);
  const labelW = labelX + labelTextLen + pad;
  const msgW = pad + msgTextLen + pad;
  const w = labelW + msgW;
  const baseline = big ? 18 : 14;

  // Message colour fills the whole pill; label overlays it with rounded left
  // corners and a square right edge so the seam stays clean.
  const labelPath =
    `M${rx},0 H${labelW} V${h} H${rx} Q0,${h} 0,${h - rx} V${rx} Q0,0 ${rx},0 Z`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}: ${esc(message)}">
  <title>${esc(label)}: ${esc(message)}</title>
  <rect width="${w}" height="${h}" rx="${rx}" fill="#${color}"/>
  <path d="${labelPath}" fill="#555555"/>
  ${iconEl}
  <text x="${labelX}" y="${baseline}" fill="#ffffff" font-family="${FONT}" font-size="${fs}" font-weight="bold" textLength="${labelTextLen}" lengthAdjust="spacingAndGlyphs">${esc(label)}</text>
  <text x="${labelW + pad}" y="${baseline}" fill="#${text}" font-family="${FONT}" font-size="${fs}" font-weight="bold" textLength="${msgTextLen}" lengthAdjust="spacingAndGlyphs">${esc(message)}</text>
</svg>
`;
}

const BADGES = [
  { file: 'live_app.svg', style: 'badge', label: 'LIVE APP', message: 'nosih.vercel.app', color: '000000', icon: 'vercel' },
  { file: 'public_verifier.svg', style: 'badge', label: 'PUBLIC VERIFIER', message: '/verify', color: '2EA443', icon: 'shield' },
  { file: 'interactive_tour.svg', style: 'badge', label: 'INTERACTIVE TOUR', message: '39 Live Steps', color: '0969DA', icon: 'cursor' },
  { file: 'demo_video.svg', style: 'badge', label: 'DEMO VIDEO', message: 'Watch Walkthrough', color: 'CC0000', icon: 'play' },
  { file: 'research.svg', style: 'badge', label: 'RESEARCH', message: '100 Cited India Cases', color: 'F9A825', icon: 'doc', text: '1F2937' },
  { file: 'chain.svg', style: 'flat', label: 'Chain', message: 'Polygon Amoy (80002) \u2192 Hyperledger Besu QBFT', color: '8247E5' },
  { file: 'contract.svg', style: 'flat', label: 'Contract', message: 'Solidity 0.8.20 \u00b7 OpenZeppelin 5', color: 'AA6740' },
  { file: 'storage.svg', style: 'flat', label: 'Storage', message: 'AES-256-GCM + Pinata IPFS + Supabase RLS', color: '3ECF8E', text: '062B1F' },
  { file: 'ai_ocr.svg', style: 'flat', label: 'AI OCR', message: 'Gemini 3.6 Flash (Text + Vision)', color: '4285F4' },
  { file: 'verification.svg', style: 'flat', label: 'Verification', message: '< 1.4 Seconds', color: '00897B' }
];

mkdirSync(OUT_DIR, { recursive: true });
for (const spec of BADGES) {
  writeFileSync(join(OUT_DIR, spec.file), badgeSvg(spec));
  console.log(`wrote images/badges/${spec.file}`);
}
console.log(`PASS: ${BADGES.length} badges generated in ${OUT_DIR}`);
