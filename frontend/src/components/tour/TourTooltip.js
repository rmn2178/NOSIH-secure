import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, ArrowLeft, X, LogIn } from "lucide-react";

const CARD_WIDTH = 340;
const MARGIN = 16;
const GAP = 16;

/** Where the card sits relative to the hole, and how it flips near an edge. */
function computePosition(rect, placement, cardWidth, cardHeight, vw, vh) {
  if (!rect) return { left: MARGIN, top: MARGIN };

  let left;
  let top;

  switch (placement) {
    case "top":
      top = rect.top - cardHeight - GAP;
      left = rect.left;
      break;
    case "left":
      left = rect.left - cardWidth - GAP;
      top = rect.top;
      break;
    case "right":
      left = rect.right + GAP;
      top = rect.top;
      break;
    case "bottom":
    default:
      top = rect.bottom + GAP;
      left = rect.left;
      break;
  }

  // Flip to the other side when the preferred one does not fit.
  if (placement === "top" && top < MARGIN) top = rect.bottom + GAP;
  else if (placement === "bottom" && top + cardHeight > vh - MARGIN) top = rect.top - cardHeight - GAP;
  else if (placement === "left" && left < MARGIN) left = rect.right + GAP;
  else if (placement === "right" && left + cardWidth > vw - MARGIN) left = rect.left - cardWidth - GAP;

  left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, vw - cardWidth - MARGIN));
  top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, vh - cardHeight - MARGIN));

  return { left, top };
}

export function TourTooltip({
  step,
  gate,
  visible,
  stepNumber,
  total,
  target,
  placement,
  onNext,
  onPrev,
  onSkip,
}) {
  const cardRef = useRef(null);
  const [position, setPosition] = useState({ left: MARGIN, top: MARGIN });
  const [size, setSize] = useState({ width: CARD_WIDTH, height: 220 });

  // ── Keep the card next to the hole ────────────────────
  useLayoutEffect(() => {
    const place = () => {
      if (!target) return;

      const rect = target.getBoundingClientRect();
      if (!rect.width && !rect.height) {
        // The element has gone — the page moved on. Hold the card where it
        // is so it glides to the new spot, but keep it on screen.
        setPosition((p) => ({
          left: Math.min(
            Math.max(p.left, MARGIN),
            Math.max(MARGIN, window.innerWidth - size.width - MARGIN)
          ),
          top: Math.min(
            Math.max(p.top, MARGIN),
            Math.max(MARGIN, window.innerHeight - size.height - MARGIN)
          ),
        }));
        return;
      }

      setPosition(
        computePosition(
          rect,
          placement,
          size.width,
          size.height,
          window.innerWidth,
          window.innerHeight
        )
      );
    };

    place();

    const onResize = () => place();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);

    const observer =
      typeof ResizeObserver !== "undefined" && cardRef.current
        ? new ResizeObserver(() => {
            const box = cardRef.current.getBoundingClientRect();
            setSize({ width: box.width, height: box.height });
          })
        : null;
    if (observer && cardRef.current) observer.observe(cardRef.current);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      if (observer) observer.disconnect();
    };
  }, [target, placement, size.width, size.height]);

  // ── Focus the card, and keep Tab inside it ────────────
  useEffect(() => {
    if (!visible) return undefined;
    const node = cardRef.current;
    if (!node) return undefined;

    const focusables = () =>
      Array.from(
        node.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.disabled && el.offsetParent !== null);

    const first = focusables()[0];
    if (first) first.focus();

    const onKey = (event) => {
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

    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, [visible]);

  const signIn = useCallback(() => {
    window.dispatchEvent(new CustomEvent("nosih:tour-signin"));
  }, []);

  if (gate !== null) {
    return (
      <div
        ref={cardRef}
        className={`tour-tooltip tour-tooltip-gate ${visible ? "is-visible" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-gate-title"
        style={{ left: position.left, top: position.top }}
      >
        <div className="tour-card-body" key="gate">
          <h3 id="tour-gate-title" className="tour-tooltip-title">
            Sign in to continue
          </h3>
          <p className="tour-tooltip-body">
            The next part of the tour covers the registrar side of the system. Sign in
            with the demo account and the walkthrough carries on from there.
          </p>
          <div className="tour-tooltip-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={signIn}>
              <LogIn size={14} strokeWidth={1.75} aria-hidden="true" /> Sign in as the demo registrar
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={onSkip}>
              <X size={14} strokeWidth={1.75} aria-hidden="true" /> Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!step) return null;

  const progress = Math.max(0, Math.min(1, (stepNumber - 1) / Math.max(1, total - 1)));

  return (
    <div
      ref={cardRef}
      className={`tour-tooltip ${visible ? "is-visible" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      style={{ left: position.left, top: position.top }}
    >
      <div className="tour-progress" aria-hidden="true">
        <span className="tour-progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>

      {/* Keyed on the step, so the copy rises into place instead of the
          whole card blinking out and back in. */}
      <div className="tour-card-body" key={step.id}>
        <div className="tour-tooltip-head">
          <h3 id="tour-title" className="tour-tooltip-title">
            {step.title}
          </h3>
          <span className="tour-counter">
            {stepNumber} / {total}
          </span>
        </div>

        <p className="tour-tooltip-body">{step.body}</p>

        <div className="tour-tooltip-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onNext}
          >
            {stepNumber >= total ? "Finish" : "Next"}
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={onPrev}
            disabled={stepNumber <= 1}
            aria-label="Previous step"
          >
            <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>

          <button type="button" className="btn btn-outline btn-sm" onClick={onSkip}>
            <X size={14} strokeWidth={1.75} aria-hidden="true" /> Skip
          </button>
        </div>
      </div>
    </div>
  );
}

export default TourTooltip;
