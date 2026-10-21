// The optimistic Close/Reopen flip (app/tickets/optimistic-status.tsx), rendered in plain node.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React; // tsx compiles the .tsx with the classic JSX runtime
const require = createRequire(import.meta.url);
const formStatus = { pending: false };
require("react-dom").useFormStatus = () => formStatus;
// Stand-in for React's canary useOptimistic: while `world.flip` is set the reducer's result shows, otherwise the server status. Real React
// clears the flip when the form action's promise settles; the tests below do that by hand (`world.flip = null`) once the action settles.
const world = { flip: null };
require("react").useOptimistic = (state, reducer) => [world.flip === null ? state : reducer(state, world.flip), (to) => { world.flip = to; }];

const { TicketStatusProvider, StatusBadge, RowActions, flipThen } = await import("../../app/tickets/optimistic-status.tsx");

const noop = async () => {};
const html = (status) => renderToStaticMarkup(
  React.createElement(TicketStatusProvider, { status }, React.createElement(StatusBadge), React.createElement(RowActions, { id: 7, close: noop, reopen: noop })),
);
const buttons = (h) => [...h.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
const badge = (h) => /rounded px-2 py-0\.5 text-xs ([^"]*)">([^<]*)</.exec(h).slice(1);
const fd = () => new FormData();
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test("server status renders the matching badge and buttons (Open: Close; In review: both; Closed: Reopen)", () => {
  world.flip = null;
  assert.deepEqual([badge(html("Open")), buttons(html("Open"))], [["bg-amber-100 text-amber-800", "Open"], ["Close"]]);
  assert.deepEqual([badge(html("In review")), buttons(html("In review"))], [["bg-blue-100 text-blue-800", "In review"], ["Close", "Reopen"]]);
  assert.deepEqual([badge(html("Closed")), buttons(html("Closed"))], [["bg-green-100 text-green-800", "Closed"], ["Reopen"]]);
});

test("Close click: badge and buttons flip to Closed while the server action is still running, then revert if it didn't land", async () => {
  world.flip = null;
  const server = defer();
  const calls = [];
  const handler = flipThen((to) => { world.flip = to; }, "Closed", (f) => { calls.push(f); return server.promise; });
  const data = fd();
  const done = handler(data);
  assert.deepEqual(calls, [data], "the server action got the form data");
  assert.deepEqual([badge(html("Open")), buttons(html("Open"))], [["bg-green-100 text-green-800", "Closed"], ["Saving…"]], "flipped before the server answered");
  server.resolve(); // run() answers with a redirect to ?error=state: the row on the server is unchanged
  await done;
  world.flip = null; // React drops the flip once the action settles
  assert.deepEqual([badge(html("Open")), buttons(html("Open"))], [["bg-amber-100 text-amber-800", "Open"], ["Close"]], "reverted to the server's status");
});

test("Reopen click from In review or Closed flips the badge to Open (the one control left says Saving…)", () => {
  for (const start of ["In review", "Closed"]) {
    world.flip = null;
    flipThen((to) => { world.flip = to; }, "Open", noop)(fd());
    assert.deepEqual([badge(html(start)), buttons(html(start))], [["bg-amber-100 text-amber-800", "Open"], ["Saving…"]], start);
  }
  world.flip = null;
});

test("flipThen holds the flip for the whole action: it settles only after the action does, and a thrown action rejects through", async () => {
  const server = defer();
  let settled = false;
  const p = flipThen(() => {}, "Closed", () => server.promise)(fd()).then(() => { settled = true; });
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, false, "not settled while the server is working");
  server.resolve();
  await p;
  assert.equal(settled, true);
  const boom = new Error("network");
  await assert.rejects(flipThen(() => {}, "Closed", async () => { throw boom; })(fd()), (e) => e === boom);
});

test("the flip is requested before the server action starts", async () => {
  const order = [];
  await flipThen((to) => order.push(`flip:${to}`), "Closed", async () => { order.push("action"); })(fd());
  assert.deepEqual(order, ["flip:Closed", "action"]);
});

test("while the flip is unconfirmed, the control that replaced the clicked button says Saving… and is disabled; confirmed or reverted, labels are back", () => {
  const dis = (h) => [...h.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map((m) => [m[2], / disabled=""/.test(m[1])]);
  for (const [start, to] of [["Open", "Closed"], ["In review", "Closed"], ["Closed", "Open"], ["In review", "Open"]]) {
    world.flip = to;
    formStatus.pending = true; // useFormStatus is pending while the form action runs
    assert.deepEqual(dis(html(start)), [["Saving…", true]], `${start} -> ${to}`);
    world.flip = null;
    formStatus.pending = false;
    assert.ok(!buttons(html(start)).includes("Saving…"), `${start}: no Saving… once the flip is gone`);
  }
});
