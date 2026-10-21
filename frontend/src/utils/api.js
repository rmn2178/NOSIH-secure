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

// Handle 401 globally — redirect to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      sessionStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default api;

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
