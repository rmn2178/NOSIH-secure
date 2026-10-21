import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, FileUp, FolderOpen, ScanSearch } from "lucide-react";
import logo from "../assets/nosih-logo.png";

const NAV_ICON = { size: 18, strokeWidth: 1.75, "aria-hidden": true };

export default function Layout({ title, children }) {
  const navigate = useNavigate();
  const user = JSON.parse(sessionStorage.getItem("user") || "{}");

  function logout() {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("user");
    navigate("/login");
  }

  const navItems = [
    { to: "/", icon: <LayoutDashboard {...NAV_ICON} />, label: "Dashboard" },
    { to: "/register", icon: <FileUp {...NAV_ICON} />, label: "Register Deed" },
    { to: "/records", icon: <FolderOpen {...NAV_ICON} />, label: "Land Records" },
    { to: "/verify", icon: <ScanSearch {...NAV_ICON} />, label: "Verify Land" },
  ];

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src={logo} alt="NOSIH logo" className="brand-logo" />
          <span>NOSIH</span>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <small>{user.email}</small>
            <span className="role-badge">{user.role}</span>
          </div>
          <button onClick={logout} className="logout-btn">Sign Out</button>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">
        <header className="page-header">
          <h1>{title}</h1>
        </header>
        <div className="page-body">{children}</div>
      </main>
    </div>
  );
}
