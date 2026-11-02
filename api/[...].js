/**
 * Vercel Serverless Function Entry Point
 * 
 * This wraps the Express backend for Vercel's serverless environment.
 * All API routes are handled through this single function.
 */

// Load environment from root .env
import "../backend/env.js";

// Import the Express app
import app from "../backend/server.js";

// Export as Vercel serverless function
export default app;
