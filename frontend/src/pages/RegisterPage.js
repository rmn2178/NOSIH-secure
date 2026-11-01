import React, { useState, useCallback, useEffect, useRef } from "react";
import { useDropzone } from "react-dropzone";
import {
  FileUp, FileText, ScanText, Landmark, Link2, MapPin, Users, Ruler,
  ScrollText, Download, ExternalLink, RotateCcw, CircleCheck, Sparkles,
} from "lucide-react";
import { extractDeed, previewLand, registerDeed, apiErrorMessage } from "../utils/api";
import Layout from "../components/Layout";

const TX_EXPLORER_URL = process.env.REACT_APP_TX_EXPLORER_URL || "https://amoy.polygonscan.com/tx";
const ICON = { strokeWidth: 1.75, "aria-hidden": true };

const EMPTY_FORM = {
  sellerName: "", sellerGovId: "", buyerName: "", buyerGovId: "",
  state: "", district: "", taluk: "", village: "", surveyNumber: "", subdivisionNumber: "",
  area: "", areaUnit: "", boundaryNorth: "", boundarySouth: "", boundaryEast: "", boundaryWest: "",
  documentType: "", registrationNumber: "", registrationDate: "", sroOffice: "",
  landIdOverride: "",
};

const DOC_TYPES = ["Sale Deed", "Gift Deed", "Settlement Deed", "Partition Deed", "Release Deed", "Will", "Other"];
const AREA_UNITS = ["acres", "hectares", "cents", "guntha", "sq.ft", "sq.m"];
const REGISTER_STEPS = ["Encrypting the deed", "Pinning to IPFS", "Writing the record to Polygon", "Saving and generating QR"];

function Loader({ title, subtitle, file }) {
  return (
    <div className="extract-phase" role="status" aria-live="polite">
      <div className="extract-ring" aria-hidden="true" />
      <h3>{title}</h3>
      <p>{subtitle}</p>
      {file && (
        <span className="extract-file">
          <FileText size={15} {...ICON} />
          {file.name}
        </span>
      )}
      <div className="extract-track" aria-hidden="true"><span className="extract-bar" /></div>
    </div>
  );
}

export default function RegisterPage() {
  const [uiState, setUiState] = useState("upload"); // upload | extracting | form | registering | done
  const [file, setFile] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [extractNote, setExtractNote] = useState({ type: "", text: "" });
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [stepIndex, setStepIndex] = useState(0);
  const previewSeq = useRef(0);

  // ── Drop → AI extraction ──────────────────────────────
  const onDrop = useCallback(async (accepted) => {
    const dropped = accepted[0];
    if (!dropped) return;
    setFile(dropped);
    setError("");
    setResult(null);
    setUiState("extracting");

    try {
      const fd = new FormData();
      fd.append("deed", dropped);
      const { data: res } = await extractDeed(fd);
      if (res.data) {
        setForm((prev) => {
          const next = { ...prev };
          for (const [k, v] of Object.entries(res.data)) if (v && k in next) next[k] = String(v);
          return next;
        });
      }
      setExtractNote(res.success
        ? { type: "success", text: "Fields were pre-filled from the deed. Review every value before registering." }
        : { type: "error", text: res.error || "Could not read the deed. Please fill the form manually." });
    } catch (err) {
      setExtractNote({ type: "error", text: apiErrorMessage(err, "AI service unavailable. Please fill the form manually.") });
    }
    setUiState("form");
  }, []);

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    maxSize: 15 * 1024 * 1024,
  });

  // ── Live Land ID preview (debounced, Supabase only) ───
  const { state, district, taluk, surveyNumber, subdivisionNumber, landIdOverride } = form;
  useEffect(() => {
    if (uiState !== "form") return;
    const ready = landIdOverride.trim() || (state.trim() && district.trim() && surveyNumber.trim());
    if (!ready) { setPreview(null); setPreviewError(""); return; }

    const seq = ++previewSeq.current;
    const t = setTimeout(async () => {
      try {
        const { data } = await previewLand({ state, district, taluk, surveyNumber, subdivisionNumber, landIdOverride });
        if (seq === previewSeq.current) { setPreview(data); setPreviewError(""); }
      } catch (err) {
        if (seq === previewSeq.current) {
          setPreview(null);
          const d = err.response?.data;
          const detailText = typeof d?.details === "string" ? d.details : "";
          setPreviewError(detailText || apiErrorMessage(err, "Preview unavailable"));
        }
      }
    }, 450);
    return () => clearTimeout(t);
  }, [uiState, state, district, taluk, surveyNumber, subdivisionNumber, landIdOverride]);

  // Cycle the loading step text while the chain write runs
  useEffect(() => {
    if (uiState !== "registering") return;
    setStepIndex(0);
    const t = setInterval(() => setStepIndex((i) => Math.min(i + 1, REGISTER_STEPS.length - 1)), 4000);
    return () => clearInterval(t);
  }, [uiState]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function startOver() {
    setUiState("upload");
    setFile(null);
    setForm(EMPTY_FORM);
    setExtractNote({ type: "", text: "" });
    setPreview(null);
    setPreviewError("");
    setError("");
    setResult(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) return setError("Upload the deed PDF first");
    setError("");
    setUiState("registering");
    try {
      const fd = new FormData();
      fd.append("deed", file);
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      const { data } = await registerDeed(fd);
      setResult(data);
      setUiState("done");
    } catch (err) {
      const d = err.response?.data;
      const headline = apiErrorMessage(err, "Registration failed");
      const detailText = typeof d?.details === "string" ? d.details : "";
      let msg = detailText ? `${headline}: ${detailText}` : headline;
      if (d?.existingRecordId) msg += ` (record ${d.existingRecordId}, ${d.existingLandId})`;
      setError(msg);
      setUiState("form");
    }
  }

  const field = (label, key, { type = "text", placeholder = "", required = false, full = false } = {}) => (
    <div className={`field${full ? " field-full" : ""}`}>
      <label>{label}{required && <span className="req"> *</span>}</label>
      <input type={type} value={form[key]} onChange={set(key)} placeholder={placeholder} required={required} />
    </div>
  );

  const select = (label, key, options) => (
    <div className="field">
      <label>{label}</label>
      <select value={form[key]} onChange={set(key)}>
        <option value="">Select…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        {form[key] && !options.includes(form[key]) && <option value={form[key]}>{form[key]}</option>}
      </select>
    </div>
  );

  const linking = preview?.exists;

  return (
    <Layout title="Register Deed">
      <div className="card">
        {uiState === "upload" && (
          <>
            <h2 className="section-title section-title-icon">
              <FileUp size={20} {...ICON} />
              New Land Deed
            </h2>
            <div {...getRootProps()} className={`dropzone ${isDragActive ? "active" : ""}`}>
              <input {...getInputProps()} />
              <p>{isDragActive ? "Drop the deed here…" : "Drag & drop the registered deed PDF, or click to browse"}</p>
              <small className="dropzone-hint">
                <ScanText size={14} {...ICON} />
                AI pre-fills survey, boundary and registration details
              </small>
              <small className="dropzone-hint">PDF only, max 15 MB. The file is encrypted before it leaves the server.</small>
            </div>
            {fileRejections.length > 0 && <div className="alert alert-error">Only a single PDF up to 15 MB is accepted.</div>}
          </>
        )}

        {uiState === "extracting" && (
          <Loader title="Reading the deed" subtitle="Extracting survey, boundary and registration details…" file={file} />
        )}

        {uiState === "registering" && (
          <Loader title={REGISTER_STEPS[stepIndex]} subtitle="This takes a few seconds while Polygon confirms the transaction." file={file} />
        )}

        {uiState === "form" && (
          <form onSubmit={handleSubmit}>
            <div className="form-head">
              <h2 className="section-title section-title-icon" style={{ margin: 0 }}>
                <ScrollText size={20} {...ICON} />
                Review & Register
              </h2>
              <button type="button" className="btn btn-outline btn-sm" onClick={startOver}>
                <RotateCcw size={14} {...ICON} /> Start over
              </button>
            </div>

            {file && (
              <div className="file-chip">
                <FileText size={16} {...ICON} />
                <strong>{file.name}</strong>
                <span>{(file.size / 1024).toFixed(1)} KB</span>
              </div>
            )}

            {extractNote.text && (
              <div className={`alert ${extractNote.type === "success" ? "alert-neutral" : "alert-error"}`}>
                {extractNote.type === "success" && <Sparkles size={15} {...ICON} />} {extractNote.text}
              </div>
            )}

            {/* Land ID panel */}
            <div className={`land-id-panel ${linking ? "is-linked" : ""}`}>
              <div className="land-id-main">
                <span className="land-id-label">Land ID</span>
                <span className="land-id-value">{preview?.landId || "LAND-··········"}</span>
                <span className="land-id-sub">
                  {previewError
                    ? previewError
                    : !preview
                      ? "Enter state, district and survey number to derive the Land ID"
                      : linking
                        ? <><Link2 size={13} {...ICON} /> Existing parcel. This deed links to {preview.head.recordId} ({preview.recordCount} record{preview.recordCount === 1 ? "" : "s"})</>
                        : "New parcel. This will be the first record."}
                </span>
                {linking && (
                  <span className="land-id-sub">
                    Previous owner is taken from the current record: <strong>{preview.head.currentOwnerName || preview.head.currentOwnerId}</strong>
                    {preview.head.status === "revoked" && " (current record is revoked, so the owner before it is used)"}
                  </span>
                )}
              </div>
              <div className="field land-id-override">
                <label>Link to existing Land ID</label>
                <input type="text" value={form.landIdOverride} onChange={set("landIdOverride")} placeholder="Optional, e.g. LAND-23D407E005" />
              </div>
            </div>

            <h3 className="form-section-title"><Users size={16} {...ICON} /> Parties</h3>
            <div className="form-grid">
              {field("Buyer / new owner", "buyerName", { required: true, placeholder: "Full name as on the deed" })}
              {field("Buyer government ID ref", "buyerGovId", { placeholder: "Optional, stored only as a keyed hash" })}
              {!linking && field("Seller / previous owner", "sellerName", { placeholder: "Full name (first record only)" })}
              {!linking && field("Seller government ID ref", "sellerGovId", { placeholder: "Optional" })}
            </div>

            <h3 className="form-section-title"><MapPin size={16} {...ICON} /> Location</h3>
            <div className="form-grid">
              {field("State", "state", { required: true, placeholder: "Tamil Nadu" })}
              {field("District", "district", { required: true, placeholder: "Chennai" })}
              {field("Taluk", "taluk", { placeholder: "Guindy" })}
              {field("Village", "village", { placeholder: "Velachery" })}
              {field("Survey number", "surveyNumber", { required: true, placeholder: "123/4" })}
              {field("Subdivision", "subdivisionNumber", { placeholder: "A" })}
            </div>

            <h3 className="form-section-title"><Ruler size={16} {...ICON} /> Land details</h3>
            <div className="form-grid">
              {field("Area", "area", { placeholder: "2.45" })}
              {select("Area unit", "areaUnit", AREA_UNITS)}
              {field("North boundary", "boundaryNorth")}
              {field("South boundary", "boundarySouth")}
              {field("East boundary", "boundaryEast")}
              {field("West boundary", "boundaryWest")}
            </div>

            <h3 className="form-section-title"><Landmark size={16} {...ICON} /> Registration</h3>
            <div className="form-grid">
              {select("Document type", "documentType", DOC_TYPES)}
              {field("Registration number", "registrationNumber", { placeholder: "1234/2026" })}
              {field("Registration date", "registrationDate", { type: "date" })}
              {field("Sub-Registrar office", "sroOffice", { placeholder: "SRO Velachery" })}
            </div>

            <p className="privacy-note">
              Only hashes, the encrypted file's CID and owner registry IDs are written on-chain. Names, survey numbers and boundaries stay in the access-controlled database.
            </p>

            {error && <div className="alert alert-error">{error}</div>}

            <button type="submit" className="btn btn-primary" disabled={!file || Boolean(previewError)}>
              <Landmark size={16} {...ICON} />
              {linking ? "Register & link to parcel" : "Register deed"}
            </button>
          </form>
        )}

        {uiState === "done" && result && (
          <div className="register-done">
            <div className="register-done-head">
              <CircleCheck size={22} {...ICON} />
              <div>
                <h3>Deed registered</h3>
                <p>
                  {result.linked
                    ? <>Linked to previous record <code>{result.previousRecordId}</code></>
                    : "First record for this parcel"}
                </p>
              </div>
            </div>

            <div className="register-done-body">
              <div className="qr-panel">
                <img src={result.qrCode} alt={`QR code for ${result.landId}`} width={220} />
                <a href={result.qrCode} download={`${result.landId}-QR.png`} className="btn btn-secondary btn-sm">
                  <Download size={14} {...ICON} /> Download QR
                </a>
              </div>

              <table className="details-table">
                <tbody>
                  <tr><td>Land ID</td><td><code className="strong-code">{result.landId}</code></td></tr>
                  <tr><td>Record ID</td><td><code>{result.recordId}</code></td></tr>
                  <tr><td>Current owner ID</td><td><code>{result.currentOwnerId}</code></td></tr>
                  {result.previousOwnerId && <tr><td>Previous owner ID</td><td><code>{result.previousOwnerId}</code></td></tr>}
                  <tr>
                    <td>Transaction</td>
                    <td>
                      <a href={`${TX_EXPLORER_URL}/${result.txHash}`} target="_blank" rel="noreferrer" className="inline-link">
                        {result.txHash.slice(0, 18)}… <ExternalLink size={13} {...ICON} />
                      </a>
                    </td>
                  </tr>
                  <tr><td>Document hash</td><td className="mono hash-cell">{result.documentHash}</td></tr>
                  <tr><td>Encrypted CID</td><td className="mono hash-cell">{result.ipfsCID}</td></tr>
                  <tr><td>Registered</td><td>{new Date(result.registeredAt).toLocaleString()}</td></tr>
                </tbody>
              </table>
            </div>

            <div className="verify-actions">
              <a href={`/verify?landId=${result.landId}`} target="_blank" rel="noreferrer" className="btn btn-outline">
                <ExternalLink size={15} {...ICON} /> Open verify page
              </a>
              <button type="button" className="btn btn-primary" onClick={startOver}>
                <FileUp size={15} {...ICON} /> Register another deed
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
