import React, { useEffect, useState } from "react";
import { listLandRecords, getLandStats } from "../utils/api";
import Layout from "../components/Layout";
import {
  Landmark,
  ScrollText,
  ArrowLeftRight,
  ShieldAlert,
  FileUp,
  ScanSearch,
  FolderOpen,
  Copy,
  Check,
  ArrowUpRight,
  ArrowRight,
} from "lucide-react";

const STAT_ICON = { size: 28, strokeWidth: 1.75 };

export default function DashboardPage() {
  const [stats, setStats] = useState({ records: 0, parcels: 0, transfers: 0, revoked: 0 });
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState(null);

  const copyId = (id, key = id) => {
    const markCopied = () => {
      setCopiedId(key);
      setTimeout(() => setCopiedId(null), 1500);
    };

    // Fallback for browsers/contexts where the async Clipboard API is denied
    const fallbackCopy = () => {
      const el = document.createElement("textarea");
      el.value = id;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ignore */
      }
      document.body.removeChild(el);
      markCopied();
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(id).then(markCopied).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  };

  useEffect(() => {
    Promise.all([getLandStats(), listLandRecords({ limit: 5 })])
      .then(([statsRes, listRes]) => {
        // A response that is not the expected shape must not reach the
        // render: `records.length` on a non-array throws inside React and
        // unmounts the whole tree, which the user sees as a blank page.
        const stats = statsRes.data;
        setStats(stats && typeof stats === "object" ? stats : {});
        const list = listRes.data;
        setRecent(Array.isArray(list?.records) ? list.records : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const StatCard = ({ icon, label, value }) => (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div className="stat-value">{loading ? "…" : value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );

  return (
    <Layout title="Dashboard">
      {/* Premium Headline */}
      <div className="dashboard-headline">
        <h2>Every deed is the permanent record,<br />Every owner is protected.</h2>
      </div>

      <div className="stats-grid">
        <StatCard icon={<Landmark {...STAT_ICON} />} label="Parcels" value={stats.parcels} />
        <StatCard icon={<ScrollText {...STAT_ICON} />} label="Records" value={stats.records} />
        <StatCard icon={<ArrowLeftRight {...STAT_ICON} />} label="Transfers" value={stats.transfers} />
        <StatCard icon={<ShieldAlert {...STAT_ICON} />} label="Revoked" value={stats.revoked} />
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h2 className="section-title">Recent Records</h2>
        {recent.length === 0 ? (
          <div className="empty-state">
            {loading ? "Loading…" : <>No land records yet. <a href="/register">Register your first deed →</a></>}
          </div>
        ) : (
          <table className="cert-table">
            <thead>
              <tr><th>Land ID</th><th>Owner</th><th>Location</th><th>Document</th><th>Status</th></tr>
            </thead>
            <tbody>
              {recent.map(r => (
                <tr key={r.recordId}>
                  <td>
                    <span className="id-cell">
                      <code>{r.landId}</code>
                      <button
                        type="button"
                        className="copy-btn"
                        title={copiedId === r.recordId ? "Copied" : "Copy Land ID"}
                        aria-label="Copy Land ID"
                        onClick={() => copyId(r.landId, r.recordId)}
                      >
                        {copiedId === r.recordId
                          ? <Check size={14} strokeWidth={2} />
                          : <Copy size={14} strokeWidth={1.75} />}
                      </button>
                    </span>
                  </td>
                  <td>{r.currentOwnerName || r.currentOwnerId}</td>
                  <td>{[r.village, r.district].filter(Boolean).join(", ") || "—"}</td>
                  <td>{r.documentType || "—"}</td>
                  <td>
                    <span className={`badge ${r.status === "revoked" ? "badge-revoked" : "badge-active"}`}>
                      {r.status === "revoked" ? "REVOKED" : "ACTIVE"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: 16 }}>
          <a href="/records" className="btn btn-outline">
            View All Records <ArrowRight size={16} strokeWidth={1.75} />
          </a>
        </div>
      </div>

      {/* Quick Action Cards */}
      <div className="action-grid">
        <a href="/register" className="action-card">
          <ArrowUpRight size={16} strokeWidth={1.75} className="action-corner" aria-hidden="true" />
          <span className="action-icon"><FileUp size={30} strokeWidth={1.75} /></span>
          <strong>Register Deed</strong>
          <small>Encrypt, link and record on-chain</small>
        </a>
        <a href="/records" className="action-card">
          <ArrowUpRight size={16} strokeWidth={1.75} className="action-corner" aria-hidden="true" />
          <span className="action-icon"><FolderOpen size={30} strokeWidth={1.75} /></span>
          <strong>Land Records</strong>
          <small>Search, open deeds, revoke</small>
        </a>
        <a href="/verify" className="action-card">
          <ArrowUpRight size={16} strokeWidth={1.75} className="action-corner" aria-hidden="true" />
          <span className="action-icon"><ScanSearch size={30} strokeWidth={1.75} /></span>
          <strong>Verify Land</strong>
          <small>Public ownership timeline</small>
        </a>
      </div>

      {/* Bottom Declaration */}
      <div className="dashboard-declaration">
        <p>Fake it until you make it — ends here.</p>
      </div>
    </Layout>
  );
}
