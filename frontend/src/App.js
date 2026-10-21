import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import RegisterPage from "./pages/RegisterPage";
import RecordsPage from "./pages/RecordsPage";
import VerifyPage from "./pages/VerifyPage";
import api from "./utils/api";

function PrivateRoute({ children }) {
  const [status, setStatus] = useState("checking"); // checking | valid | invalid

  useEffect(() => {
    const token = sessionStorage.getItem("token");
    if (!token) {
      setStatus("invalid");
      return;
    }

    // Validate token against the backend
    api.get("/auth/me")
      .then(() => setStatus("valid"))
      .catch(() => {
        sessionStorage.removeItem("token");
        sessionStorage.removeItem("user");
        setStatus("invalid");
      });
  }, []);

  if (status === "checking") return null; // brief blank while validating
  if (status === "invalid") return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/verify" element={<VerifyPage />} />

        {/* Protected Issuer Portal */}
        <Route path="/" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
        <Route path="/register" element={<PrivateRoute><RegisterPage /></PrivateRoute>} />
        <Route path="/records" element={<PrivateRoute><RecordsPage /></PrivateRoute>} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
