// The test installs a fakeDb here before rendering; the page must ask for a client, never build a query.
const state = { db: null, calls: 0 };
module.exports = { state, createServerClient() { state.calls += 1; return state.db; } };
