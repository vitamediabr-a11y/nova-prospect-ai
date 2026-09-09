export type LeadScoreInput = {
  icpFit: number;
  problemSeverity: number;
  commercialActivity: number;
  contactability: number;
  digitalInvestment: number;
  buyingIntent: number;
  strongExistingSolution?: boolean;
  recentlyContacted?: boolean;
  insufficientEvidence?: boolean;
  doNotContact?: boolean;
};

export type ScoreComponent = {
  key: string;
  label: string;
  points: number;
};

export type LeadScoreResult = {
  total: number;
  eligible: boolean;
  components: ScoreComponent[];
  explanation: string;
};

function points(value: number, max: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.round(value)));
}

export function calculateLeadScore(input: LeadScoreInput): LeadScoreResult {
  if (input.doNotContact) {
    return {
      total: 0,
      eligible: false,
      components: [{ key: "suppression", label: "Não contatar", points: -100 }],
      explanation: "Contato bloqueado pela regra de supressão.",
    };
  }

  const components: ScoreComponent[] = [
    { key: "icpFit", label: "Aderência ao ICP", points: points(input.icpFit, 25) },
    { key: "problemSeverity", label: "Problema claro", points: points(input.problemSeverity, 25) },
    { key: "commercialActivity", label: "Atividade comercial", points: points(input.commercialActivity, 15) },
    { key: "contactability", label: "Contato disponível", points: points(input.contactability, 10) },
    { key: "digitalInvestment", label: "Investimento digital", points: points(input.digitalInvestment, 10) },
    { key: "buyingIntent", label: "Sinais de intenção", points: points(input.buyingIntent, 15) },
  ];

  if (input.strongExistingSolution) {
    components.push({ key: "existingSolution", label: "Solução atual forte", points: -15 });
  }
  if (input.recentlyContacted) {
    components.push({ key: "recentContact", label: "Contato recente", points: -20 });
  }
  if (input.insufficientEvidence) {
    components.push({ key: "insufficientEvidence", label: "Evidência insuficiente", points: -10 });
  }

  const raw = components.reduce((sum, component) => sum + component.points, 0);
  const total = Math.max(0, Math.min(100, raw));
  const positives = components.filter((component) => component.points > 0).sort((a, b) => b.points - a.points);
  const negatives = components.filter((component) => component.points < 0);
  const explanationParts = [
    ...positives.slice(0, 3).map((component) => `${component.label} +${component.points}`),
    ...negatives.map((component) => `${component.label} ${component.points}`),
  ];

  return {
    total,
    eligible: true,
    components,
    explanation: explanationParts.join(" · ") || "Sem fatores suficientes para pontuação.",
  };
}
