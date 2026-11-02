import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { TOUR_STEPS, firstStepOfGroup } from "./tourSteps";
import { TourTooltip } from "./TourTooltip";
import { Spotlight } from "./Spotlight";
import { TourWelcome } from "./TourWelcome";
import "./tour.css";

const TourContext = createContext(null);

const POSITION_KEY = "nosih.tour.position";
const DECISION_KEY = "nosih.tour.decision";

/** How long the last step rests before the walkthrough closes itself. */
const LAST_STEP_DWELL = 4000;

/** The registrar session, read straight from sessionStorage. */
function isSignedIn() {
  try {
    return Boolean(sessionStorage.getItem("token"));
  } catch {
    return false;
  }
}

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Waits for an anchor to appear in the DOM and take up space. */
async function waitForElement(anchor, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const el = document.querySelector(anchor);
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) return el;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

/** True when the element already sits comfortably inside the viewport. */
function isInView(element) {
  const box = element.getBoundingClientRect();
  const margin = 48;
  // Something taller than the viewport can never be fully visible, and
  // scrolling it would not help.
  if (box.height >= window.innerHeight - margin * 2) return true;
  return box.top >= margin && box.bottom <= window.innerHeight - margin;
}

/**
 * Waits for the page to stop growing.
 *
 * Images and late data change the height of the page, and anything already
 * on screen moves down when they do. Placing the spotlight before that
 * happens leaves it pointing at the wrong place.
 */
async function waitForLayoutToSettle(timeout = 700) {
  const started = Date.now();
  let lastHeight = document.documentElement.scrollHeight;
  let stable = 0;
  while (Date.now() - started < timeout) {
    await new Promise((r) => setTimeout(r, 100));
    const height = document.documentElement.scrollHeight;
    if (height === lastHeight) {
      if (++stable >= 2) return;
    } else {
      stable = 0;
      lastHeight = height;
    }
  }
}

/** Waits until a smooth scroll has come to rest. */
async function waitForScrollToSettle() {
  const started = Date.now();
  const deadline = started + 1600;

  await new Promise((resolve) => {
    let last = null;
    let stable = 0;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("scrollend", finish);
      resolve();
    };

    // Chrome and Safari announce the end of a smooth scroll themselves.
    if ("onscrollend" in window) window.addEventListener("scrollend", finish);

    const poll = () => {
      const y = Math.round(window.scrollY);
      if (y === last) stable += 1;
      else {
        stable = 0;
        last = y;
      }
      // Four steady samples, and never before the scroll has had a chance to
      // start — a smooth scroll that has not begun yet looks perfectly still.
      if ((stable >= 4 && Date.now() - started > 450) || Date.now() > deadline) {
        finish();
        return;
      }
      setTimeout(poll, 60);
    };
    setTimeout(poll, 60);
  });
}

/**
 * Scrolls the element into view and waits for the scroll to settle.
 *
 * The spotlight is frozen while this runs, so it has to land on the element's
 * final position rather than chasing it mid-scroll.
 */
async function scrollIntoViewAndSettle(element) {
  if (prefersReducedMotion()) {
    element.scrollIntoView({ block: "center" });
    return;
  }

  // Nothing to do when it is already on screen — most steps are like this,
  // and skipping the wait keeps the tour moving at a comfortable pace.
  if (!isInView(element)) {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    await waitForScrollToSettle();
  }

  // The page may have shifted under us while the scroll was running. Let it
  // settle and take the element to the middle of the screen once more.
  if (!isInView(element)) {
    await waitForLayoutToSettle();
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    await waitForScrollToSettle();
  }
}

function readPosition() {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.index === "number" ? parsed.index : null;
  } catch {
    return null;
  }
}

function writePosition(index) {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify({ index, at: Date.now() }));
  } catch {
    /* storage disabled — the tour still works, it just will not resume */
  }
}

export function TourProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [status, setStatus] = useState("idle"); // idle | running | paused | done
  const [stepIndex, setStepIndex] = useState(-1);
  const [gate, setGate] = useState(null); // index of a step that needs a session
  const [target, setTarget] = useState(null);
  const [placement, setPlacement] = useState("bottom");
  const [visible, setVisible] = useState(false);
  const [moving, setMoving] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [resumeIndex, setResumeIndex] = useState(() => readPosition());
  const [skipped, setSkipped] = useState(() => {
    try {
      return localStorage.getItem(DECISION_KEY) === "skipped";
    } catch {
      return false;
    }
  });

  const handledDeepLink = useRef(false);
  const dwellTimer = useRef(null);
  const step = stepIndex >= 0 ? TOUR_STEPS[stepIndex] : null;
  const total = TOUR_STEPS.length;

  // A pending auto-finish must not survive the tour being torn down.
  useEffect(
    () => () => {
      if (dwellTimer.current) clearTimeout(dwellTimer.current);
    },
    []
  );

  /** Remembers the position so the tour can be resumed later. */
  const persist = useCallback((index) => {
    writePosition(index);
    setResumeIndex(index);
  }, []);

  // ── First visit: offer the walkthrough ────────────────
  useEffect(() => {
    let decision = null;
    try {
      decision = localStorage.getItem(DECISION_KEY);
    } catch {
      /* ignore */
    }
    if (!decision) setShowWelcome(true);
  }, []);

  // ── Deep link: ?tour=1 or ?tour=<group> ───────────────
  useEffect(() => {
    if (handledDeepLink.current) return;
    const value = searchParams.get("tour");
    if (!value) return;
    handledDeepLink.current = true;

    // A deep link is an explicit request — no need to ask again.
    try {
      localStorage.setItem(DECISION_KEY, "started");
    } catch {
      /* ignore */
    }
    setShowWelcome(false);

    if (value === "1" || value === "true") {
      start(0);
    } else {
      const index = firstStepOfGroup(value);
      if (index >= 0) start(index);
    }
  }, [searchParams]);

  // ── Move to a step ─────────────────────────────────────
  const goTo = useCallback((index) => {
    const target_ = TOUR_STEPS[index];
    if (!target_) return;

    if (target_.requiresAuth && !isSignedIn()) {
      setGate(index);
      setVisible(true);
      return;
    }

    setGate(null);
    setStepIndex(index);
    persist(index);
  }, []);

  const start = useCallback(
    (index = 0) => {
      setStatus("running");
      goTo(index);
    },
    [goTo]
  );

  const next = useCallback(() => {
    if (gate !== null) return;
    for (let i = stepIndex + 1; i < TOUR_STEPS.length; i++) {
      if (TOUR_STEPS[i].requiresAuth && !isSignedIn()) {
        setGate(i);
        setVisible(true);
        return;
      }
      setStepIndex(i);
      persist(i);
      return;
    }
    finish();
  }, [stepIndex, gate]);

  const prev = useCallback(() => {
    if (gate !== null) {
      setGate(null);
      return;
    }
    const index = Math.max(0, stepIndex - 1);
    setStepIndex(index);
    persist(index);
  }, [stepIndex, gate]);

  const finish = useCallback(() => {
    try {
      localStorage.setItem(DECISION_KEY, "completed");
      localStorage.removeItem(POSITION_KEY);
    } catch {
      /* ignore */
    }
    setResumeIndex(null);
    setStatus("done");
    setStepIndex(-1);
    setTarget(null);
    setMoving(false);
    setVisible(false);
  }, []);

  /** Pause and remember where we were. ESC and Skip both land here. */
  const skip = useCallback(() => {
    if (stepIndex >= 0) persist(stepIndex);
    // The step does not change when the tour pauses, so its own cleanup —
    // closing the deed modal, for one — has to run here.
    step?.after?.().catch?.(() => {});
    setStatus("paused");
    setMoving(false);
    setVisible(false);
    setTarget(null);
  }, [stepIndex, persist, step]);

  const end = useCallback(() => {
    try {
      localStorage.removeItem(POSITION_KEY);
    } catch {
      /* ignore */
    }
    setResumeIndex(null);
    setStatus("idle");
    setStepIndex(-1);
    setTarget(null);
    setMoving(false);
    setVisible(false);
  }, []);

  // ── Step transition: navigate, run hooks, find the anchor ──
  useEffect(() => {
    if (status !== "running" || !step) return undefined;

    let cancelled = false;

    (async () => {
      // The spotlight holds its position while the page moves underneath it,
      // then travels to the new element. Nothing blinks out.
      setMoving(true);

      const current = `${location.pathname}${location.search}`;
      if (current !== step.route) navigate(step.route);

      try {
        await step.before?.();
      } catch (err) {
        console.warn("[tour] before hook failed", err);
      }
      if (cancelled) return;

      // A hook can change the page — the register preview swaps in a longer
      // parcel panel, for instance. Let the reflow finish before the
      // spotlight is placed, or it lands on the old geometry.
      if (step.before) await waitForLayoutToSettle();

      const element = await waitForElement(step.anchor);
      if (cancelled) return;

      if (!element) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(`[tour] anchor not found for "${step.id}": ${step.anchor}`);
        }
        setMoving(false);
        setStepIndex((current_) => {
          const fallback = TOUR_STEPS[current_ + 1];
          if (!fallback) {
            finish();
            return current_;
          }
          persist(current_ + 1);
          return current_ + 1;
        });
        return;
      }

      await scrollIntoViewAndSettle(element);
      if (cancelled) return;

      // Releasing the spotlight and the new target in the same commit lets
      // the hole travel from where it was to where it belongs. The card's
      // placement moves with it, so the card glides once rather than twice.
      setTarget(element);
      setPlacement(step.placement);
      setMoving(false);
      setVisible(true);

      // The last step ends the tour on its own. Holding a card the visitor
      // has to dismiss is worse than letting the walkthrough close itself.
      if (stepIndex === TOUR_STEPS.length - 1) {
        dwellTimer.current = setTimeout(() => {
          dwellTimer.current = null;
          finish();
        }, LAST_STEP_DWELL);
      }
    })();

    return () => {
      cancelled = true;
      if (dwellTimer.current) {
        clearTimeout(dwellTimer.current);
        dwellTimer.current = null;
      }
    };
  }, [stepIndex, status]);

  // ── Leave the previous step cleanly ────────────────────
  const previousStep = useRef(null);
  useEffect(() => {
    if (previousStep.current && previousStep.current.id !== step?.id) {
      previousStep.current.after?.().catch?.(() => {});
    }
    previousStep.current = step;
  }, [step]);

  // ── The gate resolves once the visitor has signed in ──
  useEffect(() => {
    if (gate !== null && isSignedIn()) {
      const index = gate;
      setGate(null);
      setStepIndex(index);
      persist(index);
    }
  }, [location.pathname, location.search, gate]);

  // ── Keyboard ──────────────────────────────────────────
  useEffect(() => {
    if (status !== "running") return undefined;

    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        skip();
      } else if (event.key === "ArrowRight" || event.key === "Enter") {
        if (event.target instanceof HTMLButtonElement) return; // let the button act
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        prev();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [status, skip, next, prev]);

  // ── Welcome modal decisions ────────────────────────────
  const decide = useCallback(
    (choice) => {
      try {
        localStorage.setItem(DECISION_KEY, choice);
      } catch {
        /* ignore */
      }
      setSkipped(choice === "skipped");
      setShowWelcome(false);
      if (choice === "start") start(0);
    },
    [start]
  );

  const value = useMemo(
    () => ({
      status,
      step,
      stepIndex,
      total,
      gate,
      signedIn: isSignedIn(),
      skipped,
      showWelcome,
      start,
      next,
      prev,
      skip,
      end,
      finish,
      decide,
      resumeIndex,
    }),
    [status, step, stepIndex, total, gate, skipped, showWelcome, start, next, prev, skip, end, finish, decide]
  );

  return (
    <TourContext.Provider value={value}>
      {children}

      {status === "running" && (
        <>
          <Spotlight target={target} visible={visible} moving={moving} />
          <TourTooltip
            step={step}
            gate={gate}
            visible={visible}
            stepNumber={stepIndex + 1}
            total={total}
            target={target}
            placement={placement}
            onNext={next}
            onPrev={prev}
            onSkip={skip}
          />
          <div className="sr-only" aria-live="polite">
            {visible && step
              ? `Step ${stepIndex + 1} of ${total}: ${step.title}. ${step.body}`
              : ""}
          </div>
        </>
      )}

      {showWelcome && (
        <TourWelcome onDecide={decide} onSkip={() => decide("skipped")} />
      )}
    </TourContext.Provider>
  );
}

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used inside <TourProvider>");
  return ctx;
}
