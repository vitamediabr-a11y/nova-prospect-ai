export type ContactState = "DRAFT" | "APPROVED" | "SENT" | "DELIVERED" | "FAILED" | "RESPONDED";

export type ProspectContactGuard = {
  doNotContact: boolean;
  suppressedAt?: Date | null;
  existingAttemptStates?: ContactState[];
};

export class ContactWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContactWorkflowError";
  }
}

export function assertCanCreateFirstContact(guard: ProspectContactGuard) {
  if (guard.doNotContact || guard.suppressedAt) {
    throw new ContactWorkflowError("Contato bloqueado pela regra de supressão.");
  }

  const existing = guard.existingAttemptStates ?? [];
  if (existing.some((state) => state !== "FAILED")) {
    throw new ContactWorkflowError("Este prospect já possui uma primeira abordagem ativa ou concluída.");
  }
}

export function assertCanApproveContact(state: ContactState, guard: Pick<ProspectContactGuard, "doNotContact" | "suppressedAt">) {
  if (guard.doNotContact || guard.suppressedAt) {
    throw new ContactWorkflowError("Contato bloqueado pela regra de supressão.");
  }
  if (state !== "DRAFT") {
    throw new ContactWorkflowError("Somente rascunhos podem ser aprovados.");
  }
}

export function assertCanMarkSent(state: ContactState) {
  if (state !== "APPROVED") {
    throw new ContactWorkflowError("Somente mensagens aprovadas podem ser marcadas como enviadas.");
  }
}

export function assertCanRegisterResponse(state: ContactState) {
  if (state !== "SENT" && state !== "DELIVERED") {
    throw new ContactWorkflowError("A resposta só pode ser registrada após o envio da primeira abordagem.");
  }
}

export function nextContactStateOnResponse(state: ContactState): ContactState {
  assertCanRegisterResponse(state);
  return "RESPONDED";
}
