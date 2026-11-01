import axios from "axios";

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || "/api",
  timeout: 60000,
});

// Attach JWT token on every request
api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 globally — redirect to login.
// The login call itself is excluded: a wrong password must surface the
// server's "Invalid credentials" message inline, not bounce the page back
// to /login (which wipes the error before it can be read).
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const isLoginAttempt = (err.config?.url || "").includes("/auth/login");
    if (err.response?.status === 401 && !isLoginAttempt) {
      sessionStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default api;

/**
 * Turns any API error into a string that is safe to render.
 *
 * The backend answers `{ error: "..." }`, but a platform-level failure
 * (Vercel, a proxy, a CDN) answers `{ error: { code, message } }`. Rendering
 * that object directly makes React throw #31 and unmount the whole tree, so
 * the user gets a blank page instead of a message. Everything that shows an
 * error must go through here.
 */
export function apiErrorMessage(err, fallback = "Something went wrong") {
  const asText = (value) => {
    if (typeof value === "string") return value.trim();
    if (value && typeof value === "object") {
      if (typeof value.message === "string") return value.message.trim();
      if (typeof value.code === "string") return value.code.trim();
    }
    return "";
  };

  const data = err?.response?.data;

  const fromBody = asText(data?.error) || asText(data?.message);
  if (fromBody) return fromBody;

  // Some gateways answer with a plain-text body.
  if (typeof data === "string" && data.trim()) return data.trim();

  const fromError = asText(err);
  if (fromError) return fromError;

  return fallback;
}

// ── Auth ─────────────────────────────────────────────────
export const login = (email, password) =>
  api.post("/auth/login", { email, password });

// ── Land records (registrar) ──────────────────────────────
const multipart = { headers: { "Content-Type": "multipart/form-data" } };

/** AI pre-fill from a deed PDF. */
export const extractDeed = (formData) =>
  api.post("/land/extract", formData, { ...multipart, timeout: 90000 });

/** Live Land ID preview + current chain head (no chain reads). */
export const previewLand = (fields) => api.post("/land/preview", fields);

/** Encrypt → IPFS → chain → Supabase. */
export const registerDeed = (formData) =>
  api.post("/land/register", formData, { ...multipart, timeout: 180000 });

export const listLandRecords = (params) => api.get("/land", { params });
export const getLandStats = () => api.get("/land/stats");
export const getLandRecord = (recordId) => api.get(`/land/records/${recordId}`);
export const revokeLandRecord = (recordId, reason) =>
  api.post(`/land/records/${recordId}/revoke`, { reason }, { timeout: 120000 });

/** Decrypted deed PDF as a Blob (auth header required, so no plain link). */
export const fetchDeedDocument = (recordId) =>
  api.get(`/land/records/${recordId}/document`, { responseType: "blob", timeout: 60000 });

// ── Public verify (no auth) ───────────────────────────────
export const verifyLand = (landId) => api.get(`/verify/land/${landId}`);
export const checkLandDocument = (landId, formData) =>
  api.post(`/verify/land/${landId}/document`, formData, multipart);

/** Public QR PNG URL for a Land ID. */
export const landQrUrl = (landId, download = false) =>
  `${api.defaults.baseURL}/verify/land/${landId}/qr${download ? "?download=1" : ""}`;

/**
 * Decrypted original deed for a verified Land ID.
 * Uses a bare axios call so a 401 stays on the page instead of redirecting.
 * The API serves it to registrars only unless VIEW_DOCUMENT_POLICY=public.
 */
export async function fetchLandOriginal(landId, recordId) {
  const token = sessionStorage.getItem("token");
  const qs = recordId ? `?record=${encodeURIComponent(recordId)}` : "";
  return axios.get(`${api.defaults.baseURL}/verify/land/${landId}/document${qs}`, {
    responseType: "blob",
    timeout: 60000,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

/** Fetches the QR PNG and saves it (navigations bypass the dev proxy). */
export async function downloadLandQr(landId) {
  const res = await api.get(`/verify/land/${landId}/qr`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${landId}-QR.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
