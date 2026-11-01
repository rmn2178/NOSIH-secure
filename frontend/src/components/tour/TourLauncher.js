import React, { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { Compass, HelpCircle } from "lucide-react";
import { useTour } from "./TourProvider";
import { firstStepOfGroup } from "./tourSteps";

/** Which surface the visitor is looking at. */
function groupForPath(pathname) {
  if (pathname.startsWith("/register")) return "register";
  if (pathname.startsWith("/records")) return "records";
  if (pathname.startsWith("/verify")) return "verify";
  if (pathname.startsWith("/login")) return "login";
  return "dashboard";
}

/**
 * The buttons that open the walkthrough.
 *
 *   sidebar   a full button in the sidebar footer
 *   page-help a small "?" beside the page title
 *   floating  a fixed chip, for pages without a sidebar and small screens
 */
export function TourLauncher({ variant = "sidebar" }) {
  const { status, start, end, resumeIndex, total } = useTour();
  const location = useLocation();

  const group = useMemo(() => groupForPath(location.pathname), [location.pathname]);

  const handle = (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (status === "running") {
      end();
      return;
    }

    // A paused tour continues where it stopped; anything else starts at the
    // step for the page the visitor is already looking at.
    if (resumeIndex !== null && resumeIndex !== undefined) {
      start(resumeIndex);
    } else {
      start(firstStepOfGroup(group));
    }
  };

  if (variant === "page-help") {
    return (
      <button
        type="button"
        className="tour-launcher-help"
        onClick={handle}
        title="Show the walkthrough"
        aria-label="Show the walkthrough"
      >
        <HelpCircle size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    );
  }

  if (variant === "corner") {
    return (
      <button
        type="button"
        className="tour-launcher-help is-corner"
        onClick={handle}
        title="Show the walkthrough"
        aria-label="Show the walkthrough"
      >
        <HelpCircle size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    );
  }

  if (variant === "floating" || variant === "chip") {
    return (
      <button
        type="button"
        className="tour-launcher-floating"
        onClick={handle}
        title="Show the walkthrough"
      >
        <Compass size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>Walkthrough</span>
      </button>
    );
  }

  const label =
    status === "running"
      ? "End the walkthrough"
      : resumeIndex !== null && resumeIndex !== undefined
        ? `Resume tour (step ${resumeIndex + 1} of ${total})`
        : "Take a tour";

  return (
    <button type="button" className="tour-launcher-sidebar" onClick={handle}>
      <Compass size={15} strokeWidth={1.75} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export default TourLauncher;
