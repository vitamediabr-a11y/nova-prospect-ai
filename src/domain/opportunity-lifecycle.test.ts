import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_OPPORTUNITY_WHERE,
  evidenceLifecycleTransition,
  opportunityIsOperationallyActive,
} from "./opportunity-lifecycle";
import { websiteOpportunityKey, websiteSignalKey } from "./website-analysis";

test("resolved evidence deactivates the linked opportunity", () => {
  const resolvedAt = new Date("2026-09-09T12:00:00.000Z");
  assert.equal(evidenceLifecycleTransition({ previousResolvedAt: null, evidenceIsCurrent: false }), "RESOLVED");
  assert.equal(opportunityIsOperationallyActive({ resolvedAt }), false);
});

test("returning evidence reuses stable signal and opportunity identities and reactivates both", () => {
  const companyId = "company-1";
  const signalKeyBefore = websiteSignalKey(companyId, "NO_HOMEPAGE_FORM");
  const opportunityKeyBefore = websiteOpportunityKey(companyId, "NO_HOMEPAGE_FORM");
  const previousResolvedAt = new Date("2026-09-09T12:00:00.000Z");

  assert.equal(evidenceLifecycleTransition({ previousResolvedAt, evidenceIsCurrent: true }), "REACTIVATED");
  assert.equal(websiteSignalKey(companyId, "NO_HOMEPAGE_FORM"), signalKeyBefore);
  assert.equal(websiteOpportunityKey(companyId, "NO_HOMEPAGE_FORM"), opportunityKeyBefore);
  assert.equal(opportunityIsOperationallyActive({ resolvedAt: null }), true);
});

test("operational opportunity query convention excludes resolved evidence", () => {
  assert.deepEqual(ACTIVE_OPPORTUNITY_WHERE, { resolvedAt: null });
  const fixtures = [
    { id: "active", score: 90, resolvedAt: null },
    { id: "stale", score: 95, resolvedAt: new Date("2026-09-09T12:00:00.000Z") },
  ];
  const surfaced = fixtures.filter(opportunityIsOperationallyActive);
  assert.deepEqual(surfaced.map((item) => item.id), ["active"]);
});
