import assert from "node:assert/strict";
import test from "node:test";
import { detectOpportunity } from "./opportunity-rules";

test("sinal de Instagram para WhatsApp sem qualificação gera oportunidade específica", () => {
  const result = detectOpportunity({
    type: "INSTAGRAM_TO_WHATSAPP_NO_QUALIFICATION",
    confidence: 0.9,
    evidence: { whatsappLink: true },
  });
  assert.equal(result?.recommendedSolution, "Landing page + qualificação de lead + handoff para WhatsApp");
});

test("sinal de baixa confiança não gera oportunidade", () => {
  const result = detectOpportunity({ type: "NO_WEBSITE", confidence: 0.4, evidence: {} });
  assert.equal(result, null);
});
