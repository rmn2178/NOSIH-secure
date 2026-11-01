import React from "react";

/**
 * Last line of defence for the renderer.
 *
 * React 18 unmounts the entire tree when a render throws and nothing
 * catches it. The user sees a blank white page with no clue what happened.
 * This turns that into a readable message and a way back to the sign-in
 * screen.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info);
  }

  handleReset = () => {
    this.setState({ error: null });
    sessionStorage.clear();
    window.location.href = "/login";
  };

  render() {
    if (!this.state.error) return this.props.children;

    const message = String(this.state.error?.message || this.state.error || "Unknown error");

    return (
      <div className="error-screen">
        <div className="error-card">
          <h1>Something went wrong</h1>
          <p className="error-detail">{message}</p>
          <p className="error-hint">
            The page could not be drawn. If this repeats, the backend may be
            unavailable — check <code>/api/health</code> for its status.
          </p>
          <button type="button" className="btn btn-primary" onClick={this.handleReset}>
            Back to sign in
          </button>
        </div>
      </div>
    );
  }
}
