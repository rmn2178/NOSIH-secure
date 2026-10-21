import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import {
  Search, ShieldCheck, ShieldAlert, ShieldX, ExternalLink, ArrowRight,
  FileSearch, FileText, MapPin, Info, CircleCheck, CircleAlert,
} from "lucide-react";
import { verifyLand, checkLandDocument, landQrUrl } from "../utils/api";
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

  async function runVerify(id) {
    const value = id.trim().toUpperCase();
    if (!value) return;
    setError("");
    setData(null);
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
                      {r.status === "revoked" && (
                        <div className="timeline-revoked">
                          Revoked {fmtDate(r.revokedAt)}{r.revokeReason ? `: ${r.revokeReason}` : ""}
                          {r.revokedTxHash && (
                            <a href={`${TX_EXPLORER_URL}/${r.revokedTxHash}`} target="_blank" rel="noreferrer" className="inline-link">
                              {" "}Revocation tx <ExternalLink size={12} {...ICON} />
                            </a>
                          )}
                        </div>
                      )}
                      <details className="timeline-hashes">
                        <summary>Proof data</summary>
                        <div><span>Document hash</span><code className="hash-cell">{r.documentHash}</code></div>
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
    </div>
  );
}
