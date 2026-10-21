/**
 * Shared runtime config.
 *
 * Vercel Functions cap request bodies at 4.5 MB, so uploads default to 4 MB
 * there and 15 MB locally. Set MAX_UPLOAD_MB to override either.
 */
const fallbackMb = process.env.VERCEL ? 4 : 15;

export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || fallbackMb;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
