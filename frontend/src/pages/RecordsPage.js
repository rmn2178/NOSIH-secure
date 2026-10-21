import React, { useState, useEffect, useCallback } from "react";
import { ExternalLink, FileText, QrCode, Ban, Search } from "lucide-react";
import { listLandRecords, revokeLandRecord, fetchDeedDocument, downloadLandQr } from "../utils/api";
import Layout from "../components/Layout";

const ICON = { size: 14, strokeWidth: 1.75, "aria-hidden": true };
const PAGE_SIZE = 20;

export default function RecordsPage() {
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [latestOnly, setLatestOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await listLandRecords({ page, search, limit: PAGE_SIZE, latestOnly });
      setRecords(data.records);
      setTotal(data.total);
    } catch (e) {
      setError(e.response?.data?.error || "Could not load records");
    } finally {
      setLoading(false);
    }
  }, [page, search, latestOnly]);

  useEffect(() => {
    const t = setTimeout(fetchRecords, 250);
    return () => clearTimeout(t);
  }, [fetchRecords]);

  async function handleRevoke(rec) {
    const reason = window.prompt(
      `Revoke ${rec.recordId} (${rec.landId})?\nThis is permanent on the blockchain. Enter the reason (recorded on-chain):`
    );
    if (reason === null) return;
    if (!reason.trim()) return alert("A reason is required.");
    setBusy(rec.recordId + ":revoke");
    try {
      await revokeLandRecord(rec.recordId, reason.trim());
      fetchRecords();
    } catch (err) {
      alert(err.response?.data?.error || "Revocation failed");
    } finally {
      setBusy("");
    }
  }

  async function openDeed(rec) {
    const win = window.open("", "_blank");
    setBusy(rec.recordId + ":doc");
    try {
      const res = await fetchDeedDocument(rec.recordId);
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      if (win) win.location.href = url;
      else window.location.href = url;
      if (res.headers["x-document-hash-match"] === "false") {
        alert("Warning: the decrypted document does not match the registered hash.");
      }
    } catch (err) {
      win?.close();
      let msg = "Could not open the deed";
      try { msg = JSON.parse(await err.response.data.text()).error || msg; } catch { /* blob body */ }
      alert(msg);
    } finally {
      setBusy("");
    }
  }

  return (
    <Layout title="Land Records">
      <div className="card">
        <div className="toolbar">
          <div className="search-wrap">
            <Search size={16} strokeWidth={1.75} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search Land ID, record, survey no., village, owner…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="search-input"
            />
          </div>
          <label className="toggle">
            <input type="checkbox" checked={latestOnly} onChange={(e) => { setLatestOnly(e.target.checked); setPage(1); }} />
            Current records only
          </label>
          <span className="total-count">{total} record{total === 1 ? "" : "s"}</span>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {loading && records.length === 0 ? (
          <div className="loading-state">Loading…</div>
        ) : records.length === 0 ? (
          <div className="empty-state">No land records found. <a href="/register">Register a deed</a></div>
        ) : (
          <div className="table-wrapper">
            <table className="cert-table">
              <thead>
                <tr>
                  <th>Land ID</th>
                  <th>Record</th>
                  <th>Owner</th>
                  <th>Location</th>
                  <th>Document</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.recordId} className={r.status === "revoked" ? "row-revoked" : ""}>
                    <td><code>{r.landId}</code></td>
                    <td>
                      <code>{r.recordId}</code>
                      {r.previousRecordId && <small className="sub-line">after {r.previousRecordId}</small>}
                    </td>
                    <td>
                      <div>{r.currentOwnerName || "—"}</div>
                      <small className="sub-line mono">{r.currentOwnerId}</small>
                    </td>
                    <td>
                      <div>{[r.village, r.district].filter(Boolean).join(", ") || "—"}</div>
                      <small className="sub-line">S.No. {r.surveyNumber}{r.subdivisionNumber ? `/${r.subdivisionNumber}` : ""}</small>
                    </td>
                    <td>
                      <div>{r.documentType || "—"}</div>
                      <small className="sub-line">{r.registrationDate || new Date(r.createdAt).toLocaleDateString()}</small>
                    </td>
                    <td>
                      <div className="badge-stack">
                        <span className={`badge ${r.status === "revoked" ? "badge-revoked" : "badge-active"}`}>
                          {r.status === "revoked" ? "REVOKED" : "ACTIVE"}
                        </span>
                        {r.isLatest && <span className="badge badge-neutral">CURRENT</span>}
                      </div>
                    </td>
                    <td>
                      <div className="action-btns">
                        <a href={`/verify?landId=${r.landId}`} className="btn btn-sm btn-secondary" target="_blank" rel="noreferrer" title="Public verify page">
                          <ExternalLink {...ICON} /> Verify
                        </a>
                        <button className="btn btn-sm btn-outline" onClick={() => openDeed(r)} disabled={busy === r.recordId + ":doc"} title="Decrypt and open the deed">
                          <FileText {...ICON} /> {busy === r.recordId + ":doc" ? "…" : "Deed"}
                        </button>
                        <button className="btn btn-sm btn-outline" onClick={() => downloadLandQr(r.landId)} title="Download QR">
                          <QrCode {...ICON} /> QR
                        </button>
                        {r.status !== "revoked" && (
                          <button className="btn btn-sm btn-danger" onClick={() => handleRevoke(r)} disabled={busy === r.recordId + ":revoke"}>
                            <Ban {...ICON} /> {busy === r.recordId + ":revoke" ? "Revoking…" : "Revoke"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="pagination">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>← Prev</button>
          <span>Page {page}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={page * PAGE_SIZE >= total}>Next →</button>
        </div>
      </div>
    </Layout>
  );
}
