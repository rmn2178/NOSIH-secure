import React, { useCallback, useEffect, useState } from "react";

const PADDING = 8;

/**
 * The dimming overlay with a cut-out hole over the element under discussion.
 *
 * One fixed rectangle is moved to the target's bounding box and darkened with
 * an oversized box-shadow. The hole has `pointer-events: none`, so the page
 * underneath stays clickable while the tour is describing it.
 */
export function Spotlight({ target, visible }) {
  const [rect, setRect] = useState(null);

  const update = useCallback(() => {
    if (!target) return;
    const box = target.getBoundingClientRect();
    if (!box.width && !box.height) return;
    setRect({
      top: box.top - PADDING,
      left: box.left - PADDING,
      width: box.width + PADDING * 2,
      height: box.height + PADDING * 2,
    });
  }, [target]);

  useEffect(() => {
    if (!target) {
      setRect(null);
      return undefined;
    }

    update();

    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (observer) observer.observe(target);

    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);

    return () => {
      if (observer) observer.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [target, update]);

  if (!rect) return null;

  return (
    <div className="tour-layer" aria-hidden="true">
      <div
        className={`tour-spotlight ${visible ? "is-visible" : ""}`}
        style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      >
        <span className="tour-spotlight-ring" />
      </div>
    </div>
  );
}

export default Spotlight;
