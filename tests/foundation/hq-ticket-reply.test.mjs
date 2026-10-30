// 0017: hq_ticket_reply posts a 'bcns' message and moves Open to In review; it never closes and never writes on a Closed ticket.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetDb, sql, one, errorOf } from "./harness.mjs";

const asHq = (q) => `set role hq_tickets; ${q}`;
before(() => {
  resetDb();
  sql(`insert into tickets (ticketdate, description, status) values
    (current_date, 'reply open', 'Open'), (current_date, 'reply in review', 'In review'), (current_date, 'reply closed', 'Closed');`);
});
after(() => sql(`delete from ticket_messages; delete from tickets;`));
const tid = (d) => one(`select id from tickets where description = '${d}'`);
const status = (id) => one(`select status from tickets where id = ${id}`);
const msgs = (id) => sql(`select author, body from ticket_messages where ticketid = ${id} order by id`);

test("reply on an Open ticket writes one 'bcns' message and moves it to In review", () => {
  const id = tid("reply open");
  assert.equal(one(asHq(`select hq_ticket_reply(${id}, 'looking into it')`)), "1");
  assert.deepEqual(msgs(id), [["bcns", "looking into it"]]);
  assert.equal(status(id), "In review");
});

test("reply on an In review ticket adds a message and leaves the status", () => {
  const id = tid("reply in review");
  assert.equal(one(asHq(`select hq_ticket_reply(${id}, 'first')`)), "1");
  assert.equal(one(asHq(`select hq_ticket_reply(${id}, 'second')`)), "1");
  assert.deepEqual(msgs(id), [["bcns", "first"], ["bcns", "second"]]);
  assert.equal(status(id), "In review");
});

test("reply on a Closed ticket, a missing id, or a blank/null body returns 0 and writes nothing", () => {
  const closed = tid("reply closed");
  const open = tid("reply open");
  const count0 = one(`select count(*) from ticket_messages`);
  assert.equal(one(asHq(`select hq_ticket_reply(${closed}, 'too late')`)), "0");
  assert.equal(one(asHq(`select hq_ticket_reply(999999, 'no such ticket')`)), "0");
  for (const b of [`''`, `'   '`, `null`]) assert.equal(one(asHq(`select hq_ticket_reply(${open}, ${b})`)), "0");
  assert.equal(one(`select count(*) from ticket_messages`), count0);
  assert.equal(status(closed), "Closed");
});

test("only hq_tickets can call it", () => {
  for (const r of ["anon", "authenticated"])
    assert.match(errorOf(`set role ${r}; select hq_ticket_reply(1, 'x')`) ?? "", /permission denied/);
});
