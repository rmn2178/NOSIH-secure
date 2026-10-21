import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import {
  Search, ShieldCheck, ShieldAlert, ShieldX, ExternalLink, ArrowRight,
  FileSearch, FileText, MapPin, Info, CircleCheck, CircleAlert, Lock, Download, X,
} from "lucide-react";
import { verifyLand, checkLandDocument, landQrUrl, fetchLandOriginal } from "../utils/api";
import logo from "../assets/nosih-logo.png";

const TX_EXPLORER_URL = process.env.REACT_APP_TX_EXPLORER_URL || "https://amoy.polygonscan.com/tx";
const ICON = { strokeWidth: 1.75, "aria-hidden": true };

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");

function integrityOk(i) {
  return i?.onChain && i.documentHashMatch && i.propertyIdMatch && i.statusMatch;
}

function DocumentCheck({ landId }) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");

  const onDrop = useCallback(async (accepted) => {
    const f = accepted[0];
    if (!f) return;
    setFileName(f.name);
    setChecking(true);
    setResult(null);
    setError("");
    try {
      const fd = new FormData();
      fd.append("deed", f);
      const { data } = await checkLandDocument(landId, fd);
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.error || "Document check failed");
    } finally {
      setChecking(false);
    }
  }, [landId]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { "application/pdf": [".pdf"] }, maxFiles: 1, maxSize: 15 * 1024 * 1024,
  });

  const tone = !result ? "" : !result.match ? "bad" : result.record?.status === "revoked" || !result.isLatest ? "warn" : "good";

  return (
    <section className="result-section">
      <h3>Check a deed PDF</h3>
      <div {...getRootProps()} className={`dropzone dropzone-compact ${isDragActive ? "active" : ""}`}>
        <input {...getInputProps()} />
        <p className="dropzone-inline">
          <FileSearch size={18} {...ICON} />
          {checking ? "Hashing and comparing…" : "Drop a deed PDF to compare it with the registered versions"}
        </p>
        <small className="dropzone-hint">The file is hashed for comparison only and is not stored.</small>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {result && (
        <div className={`doc-verdict doc-verdict-${tone}`}>
          {tone === "good" ? <CircleCheck size={18} {...ICON} /> : <CircleAlert size={18} {...ICON} />}
          <div>
            <strong>{result.verdict}</strong>
            <div className="doc-verdict-meta">
              <FileText size={13} {...ICON} /> {fileName}
              {result.record && <> · record <code>{result.record.recordId}</code></>}
            </div>
            <div className="mono hash-cell">{result.uploadedHash}</div>
          </div>
        </div>
      )}
    </section>
  );
}

export default function VerifyPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [landId, setLandId] = useState(searchParams.get("landId") || "");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [viewingId, setViewingId] = useState("");
  const [viewErrors, setViewErrors] = useState({});
  const [docView, setDocView] = useState(null);

  function closeDoc() {
    if (docView?.url) URL.revokeObjectURL(docView.url);
    setDocView(null);
  }

  useEffect(() => {
    if (!docView) return undefined;
    const onKey = (e) => { if (e.key === "Escape") closeDoc(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [docView]);

  async function openOriginal(recordId) {
    if (!data) return;
    setViewErrors((m) => ({ ...m, [recordId]: "" }));
    setViewingId(recordId);
    try {
      const res = await fetchLandOriginal(data.landId, recordId);
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      setDocView({ recordId, url });
    } catch (err) {
      const status = err.response?.status;
      let msg = "Could not load the registered deed.";
      if (status === 401) msg = "Sign in as a registrar to view the original deed.";
      else if (status === 409) msg = "This record is not confirmed on-chain, so its deed is not served.";
      else if (status === 404) msg = "This record's deed could not be found.";
      setViewErrors((m) => ({ ...m, [recordId]: msg }));
    } finally {
      setViewingId("");
    }
  }

  async function runVerify(id) {
    const value = id.trim().toUpperCase();
    if (!value) return;
    setError("");
    setData(null);
    setViewErrors({});
    setViewingId("");
    setLoading(true);
    try {
      const res = await verifyLand(value);
      setData(res.data);
      setSearchParams({ landId: value }, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  // Auto-verify when opened from a QR scan
  useEffect(() => {
    const fromUrl = searchParams.get("landId");
    if (fromUrl) runVerify(fromUrl);
  }, []);

  const timeline = data ? [...data.records].reverse() : [];

  return (
    <div className="verify-wrapper">
      <div className="verify-header">
        <img src={logo} alt="NOSIH logo" className="logo-img" />
        <h1>NOSIH</h1>
        <p>Land Record Verification</p>
      </div>

      <div className="verify-card">
        <form onSubmit={(e) => { e.preventDefault(); runVerify(landId); }}>
          <label className="verify-label">Enter Land ID</label>
          <div className="input-row">
            <input
              type="text"
              value={landId}
              onChange={(e) => setLandId(e.target.value)}
              placeholder="LAND-XXXXXXXXXX"
              className="verify-input mono"
              spellCheck={false}
            />
            <button type="submit" className="btn btn-primary" disabled={loading}>
              <Search size={16} {...ICON} /> {loading ? "Verifying…" : "Verify"}
            </button>
          </div>
        </form>

        {error && <div className="alert alert-error">{error}</div>}

        {loading && (
          <div className="extract-phase compact" role="status">
            <div className="extract-ring" aria-hidden="true" />
            <p>Reading records and confirming them on Polygon…</p>
          </div>
        )}

        {data && (
          <div className="verify-result">
            <div className={`status-banner ${data.status === "revoked" ? "status-revoked" : "status-valid"}`}>
              {data.status === "revoked"
                ? <><ShieldX size={20} {...ICON} /> CURRENT RECORD REVOKED</>
                : <><ShieldCheck size={20} {...ICON} /> REGISTERED LAND RECORD</>}
            </div>

            <div className="land-summary">
              <div className="land-summary-main">
                <span className="land-id-label">Land ID</span>
                <span className="land-id-value">{data.landId}</span>
                <span className="land-summary-loc">
                  <MapPin size={14} {...ICON} />
                  {[data.location.village, data.location.taluk, data.location.district, data.location.state].filter(Boolean).join(", ")}
                </span>
                <table className="details-table compact">
                  <tbody>
                    <tr><td>Current owner ID</td><td><code>{data.currentOwnerId}</code></td></tr>
                    <tr><td>Current record</td><td><code>{data.currentRecordId}</code></td></tr>
                    <tr><td>Jurisdiction</td><td className="mono">{data.jurisdictionCode}</td></tr>
                    <tr><td>Records</td><td>{data.recordCount}</td></tr>
                  </tbody>
                </table>
                <div className={`chain-check ${data.allOnChain ? "ok" : "bad"}`}>
                  {data.allOnChain
                    ? <><ShieldCheck size={15} {...ICON} /> All {data.recordCount} record{data.recordCount === 1 ? "" : "s"} confirmed on Polygon</>
                    : <><ShieldAlert size={15} {...ICON} /> One or more records could not be confirmed on-chain</>}
                </div>
              </div>
              <img className="land-summary-qr" src={landQrUrl(data.landId)} alt={`QR for ${data.landId}`} width={150} />
            </div>

            <section className="result-section">
              <h3>Ownership history</h3>
              <ol className="timeline">
                {timeline.map((r) => (
                  <li key={r.recordId} className={`timeline-item ${r.status === "revoked" ? "is-revoked" : ""} ${r.isLatest ? "is-latest" : ""}`}>
                    <span className="timeline-dot" aria-hidden="true" />
                    <div className="timeline-card">
                      <div className="timeline-head">
                        <strong>{r.documentType || "Deed"}</strong>
                        <span className="timeline-date">{fmtDate(r.registrationDate || r.registeredAt)}</span>
                        <div className="badge-stack">
                          {r.isLatest && <span className="badge badge-neutral">CURRENT</span>}
                          <span className={`badge ${r.status === "revoked" ? "badge-revoked" : "badge-active"}`}>
                            {r.status === "revoked" ? "REVOKED" : "ACTIVE"}
                          </span>
                        </div>
                      </div>
                      <div className="owner-transfer">
                        <code>{r.previousOwnerId || "—"}</code>
                        <ArrowRight size={14} {...ICON} />
                        <code>{r.currentOwnerId}</code>
                      </div>
                      <div className="timeline-meta">
                        <span>Record <code>{r.recordId}</code></span>
                        {r.sroOffice && <span>{r.sroOffice}</span>}
                        {r.txHash && (
                          <a href={`${TX_EXPLORER_URL}/${r.txHash}`} target="_blank" rel="noreferrer" className="inline-link">
                            Transaction <ExternalLink size={12} {...ICON} />
                          </a>
                        )}
                        <span className={`chain-pill ${integrityOk(r.integrity) ? "ok" : "bad"}`}>
                          {integrityOk(r.integrity) ? "On-chain match" : r.integrity?.error ? "Chain unreachable" : "On-chain mismatch"}
                        </span>
                      </div>
                      {r.previousRecordId && (
                        <div className="timeline-link">
                          Linked from <code>{r.previousRecordId}</code>
                        </div>
                      )}
                      {r.status === "revoked" && (
                        <div className="timeline-revoked">
                          <span>
                            Revoked {fmtDate(r.revokedAt)}{r.revokeReason ? `: ${r.revokeReason}` : ""}
                          </span>
                          {r.revokedTxHash && (
                            <a href={`${TX_EXPLORER_URL}/${r.revokedTxHash}`} target="_blank" rel="noreferrer" className="inline-link">
                              Revocation tx <ExternalLink size={12} {...ICON} />
                            </a>
                          )}
                        </div>
                      )}
                      <div className="timeline-actions">
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => openOriginal(r.recordId)}
                          disabled={Boolean(viewingId) || !integrityOk(r.integrity)}
                          title={integrityOk(r.integrity)
                            ? "Decrypt this ownership's deed and check it against the chain"
                            : "This ownership record is not confirmed on-chain"}
                        >
                          <FileText size={14} {...ICON} />
                          {viewingId === r.recordId ? "Decrypting…" : "View original document"}
                        </button>
                        {viewErrors[r.recordId] && (
                          <span className="doc-access-error">
                            <Lock size={13} {...ICON} />
                            {viewErrors[r.recordId]}
                            {viewErrors[r.recordId].startsWith("Sign in") && <a href="/login">Sign in</a>}
                          </span>
                        )}
                      </div>
                      <details className="timeline-hashes">
                        <summary>Proof data</summary>
                        <div><span>Document hash</span><code className="hash-cell">{r.documentHash}</code></div>
                        {r.previousRecordHash && (
                          <div><span>Previous record hash</span><code className="hash-cell">{r.previousRecordHash}</code></div>
                        )}
                        <div><span>Encrypted CID</span><code className="hash-cell">{r.ipfsCID}</code></div>
                        <div><span>Registered on-chain</span>{r.registeredAt ? new Date(r.registeredAt).toLocaleString() : "—"}</div>
                      </details>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <DocumentCheck landId={data.landId} />

            <p className="disclaimer">
              <Info size={14} {...ICON} />
              {data.disclaimer} Owner names and survey details are held off-chain by the registry; owners appear here only as registry IDs.
            </p>
          </div>
        )}
      </div>

      <div className="verify-footer">
        <a href="/login">Registrar portal →</a>
      </div>

      {docView && (
        <div
          className="doc-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`Original deed ${docView.recordId}`}
          onClick={(e) => { if (e.target === e.currentTarget) closeDoc(); }}
        >
          <div className="doc-modal-panel">
            <div className="doc-modal-head">
              <span className="doc-modal-title">
                <FileText size={16} {...ICON} />
                Original deed · <code>{docView.recordId}</code>
              </span>
              <div className="doc-modal-actions">
                <a className="btn btn-outline btn-sm" href={docView.url} download={`${docView.recordId}.pdf`}>
                  <Download size={14} {...ICON} /> Download
                </a>
                <a className="btn btn-outline btn-sm" href={docView.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} {...ICON} /> New tab
                </a>
                <button type="button" className="btn btn-outline btn-sm" onClick={closeDoc}>
                  <X size={14} {...ICON} /> Close
                </button>
              </div>
            </div>
            <iframe src={docView.url} title={`Deed ${docView.recordId}`} />
          </div>
        </div>
      )}
    </div>
  );
}
