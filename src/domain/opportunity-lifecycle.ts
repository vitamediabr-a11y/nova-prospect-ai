export const ACTIVE_OPPORTUNITY_WHERE = { resolvedAt: null } as const;

export type EvidenceLifecycleTransition = "NONE" | "RESOLVED" | "REACTIVATED";

export function evidenceLifecycleTransition(input: {
  previousResolvedAt: Date | null;
  evidenceIsCurrent: boolean;
}): EvidenceLifecycleTransition {
  if (input.evidenceIsCurrent) {
    return input.previousResolvedAt ? "REACTIVATED" : "NONE";
  }
  return input.previousResolvedAt ? "NONE" : "RESOLVED";
}

export function opportunityIsOperationallyActive(opportunity: { resolvedAt: Date | null }) {
  return opportunity.resolvedAt === null;
}
