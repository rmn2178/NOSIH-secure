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
  const [visible, setVisible] = useState(false);
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
  const step = stepIndex >= 0 ? TOUR_STEPS[stepIndex] : null;
  const total = TOUR_STEPS.length;

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
    setVisible(false);
  }, []);

  /** Pause and remember where we were. ESC and Skip both land here. */
  const skip = useCallback(() => {
    if (stepIndex >= 0) persist(stepIndex);
    setStatus("paused");
    setVisible(false);
    setTarget(null);
  }, [stepIndex, persist]);

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
    setVisible(false);
  }, []);

  // ── Step transition: navigate, run hooks, find the anchor ──
  useEffect(() => {
    if (status !== "running" || !step) return undefined;

    let cancelled = false;

    (async () => {
      setVisible(false);

      const current = `${location.pathname}${location.search}`;
      if (current !== step.route) navigate(step.route);

      try {
        await step.before?.();
      } catch (err) {
        console.warn("[tour] before hook failed", err);
      }
      if (cancelled) return;

      const element = await waitForElement(step.anchor);
      if (cancelled) return;

      if (!element) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(`[tour] anchor not found for "${step.id}": ${step.anchor}`);
        }
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

      element.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "center",
      });

      setTarget(element);
      setVisible(true);
    })();

    return () => {
      cancelled = true;
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
          <Spotlight target={target} visible={visible} />
          <TourTooltip
            step={step}
            gate={gate}
            visible={visible}
            stepNumber={stepIndex + 1}
            total={total}
            target={target}
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
