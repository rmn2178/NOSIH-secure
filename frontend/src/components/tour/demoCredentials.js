/**
 * The demo registrar account.
 *
 * This project runs as a demo, so the walkthrough can sign in on the visitor's
 * behalf instead of making them type. The credentials are the ones seeded by
 * `npm run seed:admin`.
 *
 * ⚠  These end up in the public bundle. Anyone can read them from the
 * JavaScript, which means anyone can sign in as the registrar. That is
 * acceptable for a demo deployment and unacceptable for a real registry.
 * To switch it off, delete DEMO_CREDENTIALS below and the autofill in
 * LoginPage.js will simply have nothing to fill.
 */
export const DEMO_CREDENTIALS = {
  email: "admin@nosih.com",
  password: "NOSIH123",
};

/** True when the walkthrough was dismissed rather than started. */
export function tourWasSkipped() {
  try {
    return localStorage.getItem("nosih.tour.decision") === "skipped";
  } catch {
    return false;
  }
}
