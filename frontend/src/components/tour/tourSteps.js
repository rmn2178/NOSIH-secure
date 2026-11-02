/**
 * The guided walkthrough catalogue.
 *
 * One continuous tour across five surfaces. Every step is read-only: the tour
 * explains the system using the live fixture parcel and never submits a
 * registration or touches the Revoke button.
 *
 * The catalogue itself lives in `tourSteps.json` so that the verification
 * script (`scripts/check-tour-steps.mjs`) can read it without a bundler. This
 * module adds the behaviour hooks, which have to be functions and therefore
 * cannot live in JSON.
 *
 * A step shape:
 *   id           unique, stable — used for persistence
 *   group        surface name, used by the ?tour=<group> deep link
 *   route        the route the step lives on
 *   anchor       CSS selector for the element under the spotlight
 *   title        the card heading
 *   body         the card copy
 *   placement    where the card sits relative to the hole
 *   requiresAuth true when the route is behind the registrar session
 *   before       async hook, run before the anchor is looked up
 *   after        async hook, run after the step is left
 */

import catalogue from "./tourSteps.json";

/**
 * The parcel the tour talks about. It exists in the registry, so every value
 * below can be checked against the live API.
 */
export const FIXTURE = catalogue.fixture;

/** Puts the register page into one of its read-only preview modes. */
function setRegisterMode(mode) {
  window.dispatchEvent(
    new CustomEvent("nosih:tour-register-mode", { detail: { mode } })
  );
}

/** Opens the "Proof data" disclosure so the hashes are visible. */
function openProofData() {
  const details = document.querySelector(".timeline-hashes");
  if (details && !details.open) details.open = true;
}

/**
 * True while the registered deed is being fetched.
 *
 * The server decrypts the document and pulls it back from IPFS, which takes
 * a moment. If the tour ends in the meantime the modal arrives after the
 * cleanup has already run, so the wait is tracked here.
 */
let documentInFlight = false;

/** Opens the decrypted-deed modal when the visitor is allowed to. */
async function openDocumentModal() {
  const button = document.querySelector(".timeline-actions button");
  if (!button || button.disabled) return false;
  documentInFlight = true;
  button.click();
  // The server decrypts the deed and fetches it from IPFS, so this can take
  // a few seconds — wait for the modal rather than a fixed short delay.
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (document.querySelector(".doc-modal")) {
      documentInFlight = false;
      return true;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  documentInFlight = false;
  return false;
}

/** Closes the modal so it never covers the next step. */
function closeDocumentModal() {
  const closeButton = () =>
    Array.from(document.querySelectorAll(".doc-modal-actions button")).find((b) =>
      /close/i.test(b.textContent)
    );

  const close = closeButton();
  if (close) {
    close.click();
    return;
  }

  // The deed is still on its way. Close it the moment it arrives.
  if (documentInFlight) {
    const waiter = setInterval(() => {
      const button = closeButton();
      if (button) {
        button.click();
        clearInterval(waiter);
      }
    }, 150);
    setTimeout(() => clearInterval(waiter), 9000);
  }
}

/**
 * Behaviour hooks, keyed by step id.
 *
 * The register steps drive a read-only preview of the form instead of asking
 * the visitor to upload a deed, so nothing is ever registered on the chain
 * during the tour.
 */
const HOOKS = {
  "register-dropzone": { before: async () => setRegisterMode("default") },
  "register-land-id": { before: async () => setRegisterMode("default") },
  "register-land-id-linked": { before: async () => setRegisterMode("linked") },
  "register-parties": { before: async () => setRegisterMode("default") },
  "register-location": { before: async () => setRegisterMode("default") },
  "register-details": { before: async () => setRegisterMode("default") },
  "register-privacy": { before: async () => setRegisterMode("default") },
  "register-receipt": { before: async () => setRegisterMode("receipt") },
  "register-qr": {
    before: async () => setRegisterMode("receipt"),
    after: async () => setRegisterMode("default"),
  },
  "verify-hashes": { before: async () => openProofData() },
  "verify-view-doc": {
    before: async () => {
      await openDocumentModal();
    },
    after: async () => {
      closeDocumentModal();
    },
  },
  "verify-dropzone": {
    before: async () => {
      closeDocumentModal();
    },
  },
};

/** Every step, in order, with its hooks attached. */
export const TOUR_STEPS = catalogue.steps.map((step) => ({
  ...step,
  ...(HOOKS[step.id] || {}),
}));

/** The surfaces, in the order the tour visits them. */
export const TOUR_GROUPS = ["login", "dashboard", "register", "records", "verify"];

/** Index of the first step in a group, for the ?tour=<group> deep link. */
export function firstStepOfGroup(group) {
  return TOUR_STEPS.findIndex((s) => s.group === group);
}
