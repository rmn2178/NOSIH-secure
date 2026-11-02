/**
 * Vercel Serverless Function Entry Point
 * 
 * This wraps the Express backend for Vercel's serverless environment.
 * All API routes are handled through this single function.
 */

import app from "../backend/server.js";

// Vercel expects this specific export format
export default app;
