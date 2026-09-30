// Controlled by the page-render test. `calls` proves the page awaited the session check on every render;
// `redirect` reproduces what the real requireSession does for an anonymous caller (next/navigation throws).
const state = { calls: 0, redirect: false };
module.exports = {
  state,
  async requireSession() {
    state.calls += 1;
    if (state.redirect) { const e = new Error("NEXT_REDIRECT;/login"); e.digest = "NEXT_REDIRECT;/login"; throw e; }
    return { userId: "u1", email: "kris@example.test", role: "admin", personId: 3 };
  },
};
