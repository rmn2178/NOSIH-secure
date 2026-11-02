#!/usr/bin/env node
/**
 * Vercel Deployment Readiness Check
 * 
 * Verifies all required files and configurations are in place
 * Run: node verify-deployment-ready.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const checks = {
  '✓ API serverless wrapper': 'api/[...].js',
  '✓ OCR service': 'backend/services/ocr.js',
  '✓ Canvas utilities': 'backend/services/canvasIcu.js',
  '✓ Parallel extraction': 'backend/services/ai.js',
  '✓ Express server': 'backend/server.js',
  '✓ Vercel config': 'vercel.json',
  '✓ Deployment guide': 'VERCEL_DEPLOY.md',
  '✓ Summary doc': 'DEPLOYMENT_SUMMARY.md',
  '✓ Frontend package': 'frontend/package.json',
  '✓ Backend package': 'backend/package.json',
};

console.log('\n🔍 Vercel Deployment Readiness Check\n');
console.log('━'.repeat(50));

let allGood = true;

for (const [label, filePath] of Object.entries(checks)) {
  const fullPath = path.join(__dirname, filePath);
  const exists = fs.existsSync(fullPath);
  
  if (exists) {
    console.log(`${label} ${filePath}`);
  } else {
    console.log(`❌ MISSING: ${filePath}`);
    allGood = false;
  }
}

console.log('━'.repeat(50));

// Check vercel.json content
if (fs.existsSync(path.join(__dirname, 'vercel.json'))) {
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'));
  
  console.log('\n📦 Vercel Configuration:');
  console.log(`   Version: ${vercelConfig.version}`);
  console.log(`   Builds: ${vercelConfig.builds?.length || 0}`);
  console.log(`   Routes: ${vercelConfig.routes?.length || 0}`);
  
  const hasApiRoute = vercelConfig.routes?.some(r => r.src === '/api/(.*)');
  const hasFrontendRoute = vercelConfig.routes?.some(r => r.dest?.includes('index.html'));
  
  if (hasApiRoute) console.log('   ✓ API routing configured');
  if (hasFrontendRoute) console.log('   ✓ Frontend routing configured');
}

// Check for optimization flags
console.log('\n⚡ Optimization Features:');
const aiService = fs.readFileSync(path.join(__dirname, 'backend/services/ai.js'), 'utf8');
if (aiService.includes('analyzePDF')) console.log('   ✓ PDF analysis function');
if (aiService.includes('extractDeedMetadataParallel')) console.log('   ✓ Parallel extraction');
if (aiService.includes('Promise.race')) console.log('   ✓ Strategy racing');

const registerPage = fs.readFileSync(path.join(__dirname, 'frontend/src/pages/RegisterPage.js'), 'utf8');
if (registerPage.includes('field-updated')) console.log('   ✓ Progressive UI');
if (registerPage.includes('setUiState("form")')) console.log('   ✓ Instant form display');

console.log('\n━'.repeat(50));

if (allGood) {
  console.log('\n✅ ALL CHECKS PASSED!\n');
  console.log('Your app is ready for Vercel deployment.\n');
  console.log('Deploy now:');
  console.log('  1. npm i -g vercel');
  console.log('  2. vercel login');
  console.log('  3. vercel --prod\n');
  console.log('See VERCEL_DEPLOY.md for detailed instructions.\n');
  process.exit(0);
} else {
  console.log('\n❌ SOME FILES ARE MISSING!\n');
  console.log('Please commit and push all required files.\n');
  process.exit(1);
}
