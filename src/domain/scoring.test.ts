import assert from "node:assert/strict";
import test from "node:test";
import { calculateLeadScore } from "./scoring";

test("score é determinístico e limitado a 100", () => {
  const result = calculateLeadScore({
    icpFit: 25,
    problemSeverity: 25,
    commercialActivity: 15,
    contactability: 10,
    digitalInvestment: 10,
    buyingIntent: 15,
  });
  assert.equal(result.total, 100);
  assert.equal(result.eligible, true);
});

test("solução existente e contato recente aplicam penalidades explicáveis", () => {
  const result = calculateLeadScore({
    icpFit: 25,
    problemSeverity: 25,
    commercialActivity: 15,
    contactability: 10,
    digitalInvestment: 10,
    buyingIntent: 15,
    strongExistingSolution: true,
    recentlyContacted: true,
  });
  assert.equal(result.total, 65);
  assert.match(result.explanation, /Solução atual forte -15/);
  assert.match(result.explanation, /Contato recente -20/);
});

test("NÃO CONTATAR prevalece sobre qualquer score", () => {
  const result = calculateLeadScore({
    icpFit: 25,
    problemSeverity: 25,
    commercialActivity: 15,
    contactability: 10,
    digitalInvestment: 10,
    buyingIntent: 15,
    doNotContact: true,
  });
  assert.equal(result.total, 0);
  assert.equal(result.eligible, false);
});
