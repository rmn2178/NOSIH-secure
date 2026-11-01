import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, apiErrorMessage } from "../utils/api";
import logo from "../assets/nosih-logo.png";
import { TourLauncher } from "../components/tour/TourLauncher";
import { useTour } from "../components/tour/TourProvider";
import { DEMO_CREDENTIALS, tourWasSkipped } from "../components/tour/demoCredentials";
import "./styles.css";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const formRef = useRef(null);
  const navigate = useNavigate();
  const { skipped } = useTour();

  // ── Demo sign-in ───────────────────────────────────────
  // Skipping the walkthrough fills the form in, and the walkthrough itself
  // can ask for a sign-in when it reaches a registrar-only screen.
  const fillDemoCredentials = () => {
    setEmail(DEMO_CREDENTIALS.email);
    setPassword(DEMO_CREDENTIALS.password);
  };

  useEffect(() => {
    if (tourWasSkipped()) fillDemoCredentials();

    const onTourSignIn = () => {
      fillDemoCredentials();
      // Let React commit the values before the form is submitted.
      setTimeout(() => {
        if (formRef.current) formRef.current.requestSubmit();
      }, 80);
    };

    window.addEventListener("nosih:tour-signin", onTourSignIn);
    return () => window.removeEventListener("nosih:tour-signin", onTourSignIn);
  }, []);

  // The visitor may skip the walkthrough after this page has loaded.
  useEffect(() => {
    if (skipped) fillDemoCredentials();
  }, [skipped]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await login(email, password);
      sessionStorage.setItem("token", res.data.token);
      sessionStorage.setItem("user", JSON.stringify(res.data.user));
      navigate("/");
    } catch (err) {
      setError(apiErrorMessage(err, "Login failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <TourLauncher variant="corner" />

        <div className="auth-logo">
          <img src={logo} alt="NOSIH logo" className="logo-img" />
          <h1>NOSIH</h1>
          <p>Decentralized Deed Authentication</p>
        </div>

        <form onSubmit={handleSubmit} ref={formRef}>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="admin@nosih.com"
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <button type="submit" className="btn btn-primary full-width" disabled={loading}>
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div className="auth-links">
          <a href="/verify">🔍 Public Verification Portal</a>
        </div>
      </div>
    </div>
  );
}
