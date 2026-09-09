export type ContactState = "DRAFT" | "APPROVED" | "SENT" | "DELIVERED" | "FAILED" | "RESPONDED";

export type ProspectContactGuard = {
  doNotContact: boolean;
  suppressedAt?: Date | null;
  existingAttemptStates?: ContactState[];
};

export type ResponseTransition = {
  contactState: "RESPONDED";
  prospectStage: "RESPONDED";
  conversationStatus: "NEEDS_HUMAN";
  opportunityStatus: "RESPONDED";
};

export class ContactWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContactWorkflowError";
  }
}

function assertNotSuppressed(guard: Pick<ProspectContactGuard, "doNotContact" | "suppressedAt">) {
  if (guard.doNotContact || guard.suppressedAt) {
    throw new ContactWorkflowError("Contato bloqueado pela regra de supressão.");
  }
}

export function assertCanCreateFirstContact(guard: ProspectContactGuard) {
  assertNotSuppressed(guard);

  const existing = guard.existingAttemptStates ?? [];
  if (existing.some((state) => state !== "FAILED")) {
    throw new ContactWorkflowError("Este prospect já possui uma primeira abordagem ativa ou concluída.");
  }
}

export function assertCanApproveContact(state: ContactState, guard: Pick<ProspectContactGuard, "doNotContact" | "suppressedAt">) {
  assertNotSuppressed(guard);
  if (state !== "DRAFT") {
    throw new ContactWorkflowError("Somente rascunhos podem ser aprovados.");
  }
}

export function assertCanMarkSent(state: ContactState, guard: Pick<ProspectContactGuard, "doNotContact" | "suppressedAt">) {
  assertNotSuppressed(guard);
  if (state !== "APPROVED") {
    throw new ContactWorkflowError("Somente mensagens aprovadas podem ser marcadas como enviadas.");
  }
}

export function assertCanRegisterResponse(state: ContactState) {
  if (state !== "SENT" && state !== "DELIVERED") {
    throw new ContactWorkflowError("A resposta só pode ser registrada após o envio da primeira abordagem.");
  }
}

export function responseTransition(state: ContactState): ResponseTransition {
  assertCanRegisterResponse(state);
  return {
    contactState: "RESPONDED",
    prospectStage: "RESPONDED",
    conversationStatus: "NEEDS_HUMAN",
    opportunityStatus: "RESPONDED",
  };
}

export function nextContactStateOnResponse(state: ContactState): ContactState {
  return responseTransition(state).contactState;
}
