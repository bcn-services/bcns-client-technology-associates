// Item 1 guardrail: the bill-output env keys are optional and read at call time, not at import.
import { test } from "node:test";
import assert from "node:assert/strict";

const KEYS = ["RESEND_API_KEY", "BILL_FROM_EMAIL", "BILL_CC_EMAIL", "NOTICE_BCC_EMAIL", "BILL_TAX_ID", "BILL_LETTERHEAD", "RESEND_API_URL"];
for (const k of KEYS) delete process.env[k];
const { getConfig } = await import("../../lib/env.ts");

test("with no bill keys set, getConfig returns them all undefined and does not throw", () => {
  const c = getConfig();
  for (const f of ["resendApiKey", "billFromEmail", "billCcEmail", "noticeBccEmail", "billTaxId", "billLetterhead"]) {
    assert.equal(c[f], undefined, f);
  }
});

test("keys set after import are picked up on the next call (read at call time)", () => {
  Object.assign(process.env, {
    RESEND_API_KEY: "re_test", BILL_FROM_EMAIL: "billing@example.test", BILL_CC_EMAIL: "cc@example.test",
    NOTICE_BCC_EMAIL: "bcc@example.test", BILL_TAX_ID: "00-0000000", BILL_LETTERHEAD: "Example Firm\\n1 Main St\nExampletown",
  });
  try {
    const c = getConfig();
    assert.equal(c.resendApiKey, "re_test");
    assert.equal(c.billFromEmail, "billing@example.test");
    assert.equal(c.billCcEmail, "cc@example.test");
    assert.equal(c.noticeBccEmail, "bcc@example.test");
    assert.equal(c.billTaxId, "00-0000000");
    assert.deepEqual(c.billLetterhead, ["Example Firm", "1 Main St", "Exampletown"]);
    process.env.BILL_FROM_EMAIL = "   ";
    assert.equal(getConfig().billFromEmail, undefined, "whitespace counts as unset");
  } finally {
    for (const k of KEYS) delete process.env[k];
  }
});

test("RESEND_API_URL defaults to the real API when unset or blank, and a set value overrides it", () => {
  try {
    assert.equal(getConfig().resendApiUrl, "https://api.resend.com");
    process.env.RESEND_API_URL = "  ";
    assert.equal(getConfig().resendApiUrl, "https://api.resend.com", "blank counts as unset");
    process.env.RESEND_API_URL = "http://127.0.0.1:3999";
    assert.equal(getConfig().resendApiUrl, "http://127.0.0.1:3999");
  } finally {
    delete process.env.RESEND_API_URL;
  }
});

test("a BILL_LETTERHEAD with no non-blank line is undefined, never []", () => {
  try {
    for (const v of ["", "   ", "\n", "\n\n", "\\n", " \\n \n\\n "]) {
      process.env.BILL_LETTERHEAD = v;
      assert.equal(getConfig().billLetterhead, undefined, JSON.stringify(v));
    }
  } finally {
    delete process.env.BILL_LETTERHEAD;
  }
});
