// 0014: an emailed reply flips its ticket to In review inside the insert's own transaction (the inbound route relies on it).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { resetDb, sql, one, errorOf } from "./harness.mjs";

before(() => {
  resetDb();
  sql(`insert into tickets (ticketdate, description, status) values ('2026-10-01','open one','Open'), ('2026-10-02','closed one','Closed'), ('2026-10-03','mid one','Open');`);
});
const status = (id) => one(`select status from tickets where id = ${id}`);

test("author 'email' moves an Open ticket and a Closed ticket to In review; a staff message does not", () => {
  sql(`insert into ticket_messages (ticketid, author, body) values (3, 'kris@x.test', 'working on it');`);
  assert.equal(status(3), "Open");
  sql(`insert into ticket_messages (ticketid, author, body, resend_email_id) values (1, 'email', 'looks good', 'em_1');`);
  assert.equal(status(1), "In review");
  sql(`insert into ticket_messages (ticketid, author, body, resend_email_id) values (2, 'email', 'one more thing', 'em_2');`);
  assert.equal(status(2), "In review");
});

test("a duplicate resend_email_id fails the insert and changes nothing (the retry is a no-op)", () => {
  sql(`update tickets set status = 'Closed' where id = 1;`);
  const err = errorOf(`insert into ticket_messages (ticketid, author, body, resend_email_id) values (1, 'email', 'looks good', 'em_1');`);
  assert.match(err ?? "", /duplicate key/);
  assert.equal(status(1), "Closed");
  assert.equal(one(`select count(*) from ticket_messages where resend_email_id = 'em_1'`), "1");
});

test("the status flip is audited like any other ticket update", () => {
  assert.ok(Number(one(`select count(*) from audit_log where tablename = 'tickets' and op = 'UPDATE' and newdata ->> 'status' = 'In review'`)) >= 2);
});
