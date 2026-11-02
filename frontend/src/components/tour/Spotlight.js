import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";

const PADDING = 8;

/**
 * The dimming overlay with a cut-out hole over the element under discussion.
 *
 * One fixed rectangle is moved to the target's bounding box and darkened with
 * an oversized box-shadow. The hole has `pointer-events: none`, so the page
 * underneath stays clickable while the tour is describing it.
 *
 * While `moving` is true the rectangle holds its position. The tour freezes
 * it while the page navigates and scrolls, then releases it onto the new
 * element — so the hole travels across the screen instead of blinking out
 * and back in.
 */
export function Spotlight({ target, visible, moving }) {
  const [rect, setRect] = useState(null);

  const update = useCallback(() => {
    if (!target || moving) return;
    const box = target.getBoundingClientRect();
    if (!box.width && !box.height) return;
    const next = {
      top: box.top - PADDING,
      left: box.left - PADDING,
      width: box.width + PADDING * 2,
      height: box.height + PADDING * 2,
    };
    setRect((prev) =>
      prev &&
      prev.top === next.top &&
      prev.left === next.left &&
      prev.width === next.width &&
      prev.height === next.height
        ? prev
        : next
    );
  }, [target, moving]);

  useLayoutEffect(() => {
    if (!target) {
      setRect(null);
      return undefined;
    }

    update();

    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (observer) observer.observe(target);

    // Late images and data grow the page and shift everything on it. The
    // hole follows rather than staying behind on the wrong element.
    const pageObserver =
      typeof ResizeObserver !== "undefined" && document.body
        ? new ResizeObserver(update)
        : null;
    if (pageObserver) pageObserver.observe(document.body);

    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);

    return () => {
      if (observer) observer.disconnect();
      if (pageObserver) pageObserver.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [target, update]);

  if (!rect) return null;

  return (
    <div className="tour-layer" aria-hidden="true">
      <div
        className={`tour-spotlight ${visible ? "is-visible" : ""} ${
          moving ? "is-moving" : ""
        }`}
        style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      >
        <span className="tour-spotlight-ring" />
      </div>
    </div>
  );
}

export default Spotlight;
