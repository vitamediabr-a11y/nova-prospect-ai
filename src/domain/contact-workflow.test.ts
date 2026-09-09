import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCanApproveContact,
  assertCanCreateFirstContact,
  assertCanMarkSent,
  assertCanRegisterResponse,
  ContactWorkflowError,
} from "./contact-workflow";

test("blocks contact when company is marked do not contact", () => {
  assert.throws(
    () => assertCanCreateFirstContact({ doNotContact: true, existingAttemptStates: [] }),
    ContactWorkflowError,
  );
});

test("blocks a second first approach while another attempt exists", () => {
  assert.throws(
    () => assertCanCreateFirstContact({ doNotContact: false, existingAttemptStates: ["DRAFT"] }),
    /já possui uma primeira abordagem/,
  );
});

test("allows retry after a failed attempt", () => {
  assert.doesNotThrow(() =>
    assertCanCreateFirstContact({ doNotContact: false, existingAttemptStates: ["FAILED"] }),
  );
});

test("only drafts can be approved", () => {
  assert.doesNotThrow(() => assertCanApproveContact("DRAFT", { doNotContact: false }));
  assert.throws(() => assertCanApproveContact("SENT", { doNotContact: false }), /Somente rascunhos/);
});

test("only approved contacts can be marked sent", () => {
  assert.doesNotThrow(() => assertCanMarkSent("APPROVED"));
  assert.throws(() => assertCanMarkSent("DRAFT"), /Somente mensagens aprovadas/);
});

test("response requires an actually sent or delivered first message", () => {
  assert.doesNotThrow(() => assertCanRegisterResponse("SENT"));
  assert.doesNotThrow(() => assertCanRegisterResponse("DELIVERED"));
  assert.throws(() => assertCanRegisterResponse("APPROVED"), /após o envio/);
});
