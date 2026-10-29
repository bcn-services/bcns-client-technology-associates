// 0016: the hq_tickets role can pull recent tickets and resolve one, and nothing else.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetDb, sql, one, errorOf } from "./harness.mjs";

const asHq = (q) => `set role hq_tickets; ${q}`;
before(() => {
  resetDb();
  sql(`insert into tickets (ticketdate, description, status, createdat) values
    (current_date, 'fix the thing', 'Open', now() - interval '2 days'),
    (current_date, 'old and quiet', 'Open', now() - interval '200 days'),
    (current_date, 'old but replied', 'Open', now() - interval '200 days'),
    (current_date, 'old and closed', 'Closed', now() - interval '200 days');
    insert into ticket_messages (ticketid, author, body)
    select id, 'kris@x.test', 'recent reply' from tickets where description = 'old but replied';`);
});
after(() => sql(`delete from ticket_messages; delete from tickets;`));
const tid = (d) => one(`select id from tickets where description = '${d}'`);
const status = (id) => one(`select status from tickets where id = ${id}`);

test("pull returns every open ticket and recently touched closed ones, with the mapped shape", () => {
  const rows = sql(asHq(`select id, slug, subject, body, severity, status from hq_tickets_pull() order by id`));
  assert.deepEqual(rows.map((r) => r[3]), ["fix the thing", "old and quiet", "old but replied"]);
  assert.deepEqual(rows[0].slice(1), ["technology-associates", "fix the thing", "fix the thing", "normal", "open"]);
});

test("resolve with a body writes one 'bcns' message and closes (not In review)", () => {
  const id = tid("fix the thing");
  assert.equal(one(asHq(`select hq_ticket_resolve(${id}, 'done, deployed')`)), "1");
  assert.deepEqual(sql(`select author, body from ticket_messages where ticketid = ${id}`), [["bcns", "done, deployed"]]);
  assert.equal(status(id), "Closed");
  assert.equal(one(asHq(`select status from hq_tickets_pull() where id = ${id}`)), "closed");
});

test("resolve with '' adds no message, closes, and a second call returns 0", () => {
  const id = tid("old but replied");
  assert.equal(one(asHq(`select hq_ticket_resolve(${id}, '')`)), "1");
  assert.equal(one(`select count(*) from ticket_messages where ticketid = ${id} and author = 'bcns'`), "0");
  assert.equal(status(id), "Closed");
  assert.equal(one(asHq(`select hq_ticket_resolve(${id}, '')`)), "0");
});

test("a repeat resolve with a body on a Closed ticket, or on a missing id, returns 0 and writes nothing", () => {
  const id = tid("fix the thing");
  assert.equal(one(asHq(`select hq_ticket_resolve(${id}, 'again')`)), "0");
  assert.deepEqual(sql(`select author, body from ticket_messages where ticketid = ${id}`), [["bcns", "done, deployed"]]);
  assert.equal(one(asHq(`select hq_ticket_resolve(999999, 'no such ticket')`)), "0");
});

test("resolve with a whitespace-only body closes without a message", () => {
  const id = tid("old and quiet");
  assert.equal(one(asHq(`select hq_ticket_resolve(${id}, '   ')`)), "1");
  assert.equal(one(`select count(*) from ticket_messages where ticketid = ${id}`), "0");
  assert.equal(status(id), "Closed");
});

test("hq_tickets cannot read tables; other roles cannot call the functions", () => {
  assert.match(errorOf(asHq(`select * from tickets`)) ?? "", /permission denied/);
  assert.match(errorOf(asHq(`select * from ticket_messages`)) ?? "", /permission denied/);
  for (const r of ["anon", "authenticated"])
    for (const call of ["hq_tickets_pull()", "hq_ticket_resolve(1, 'x')"])
      assert.match(errorOf(`set role ${r}; select * from ${call}`) ?? "", /permission denied/);
});
