import React, { useEffect, useRef } from "react";
import { Compass, X, ArrowRight } from "lucide-react";
import { TOUR_STEPS } from "./tourSteps";

/**
 * The first-visit prompt.
 *
 * Shown once, when the app is opened for the first time. Two ways out:
 * take the walkthrough, or skip it — skipping also fills in the demo sign-in
 * so the visitor can go straight in.
 */
export function TourWelcome({ onDecide }) {
  const cardRef = useRef(null);

  useEffect(() => {
    const node = cardRef.current;
    if (!node) return undefined;

    const focusables = () =>
      Array.from(node.querySelectorAll("button, [href]")).filter((el) => !el.disabled);

    const first = focusables()[0];
    if (first) first.focus();

    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDecide("skipped");
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDecide]);

  return (
    <div className="tour-welcome-backdrop" role="presentation" onClick={() => onDecide("skipped")}>
      <div
        ref={cardRef}
        className="tour-welcome"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-welcome-title"
        aria-describedby="tour-welcome-body"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="tour-welcome-icon" aria-hidden="true">
          <Compass size={22} strokeWidth={1.75} />
        </div>

        <h2 id="tour-welcome-title">Take the walkthrough?</h2>
        <p id="tour-welcome-body">
          A guided tour of NOSIH in {TOUR_STEPS.length} steps — what the registry is, how a
          deed is registered, what the chain actually stores, and how anyone can verify a
          parcel without an account.
        </p>
        <p className="tour-welcome-note">
          Skipping fills in the demo sign-in, so you can go straight to the registry.
        </p>

        <div className="tour-welcome-actions">
          <button type="button" className="btn btn-primary" onClick={() => onDecide("start")}>
            Take the walkthrough
            <ArrowRight size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-outline" onClick={() => onDecide("skipped")}>
            <X size={15} strokeWidth={1.75} aria-hidden="true" /> Skip
          </button>
        </div>
      </div>
    </div>
  );
}

export default TourWelcome;
