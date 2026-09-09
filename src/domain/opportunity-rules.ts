export type SignalSnapshot = {
  type: string;
  confidence: number;
  evidence: unknown;
};

export type OpportunitySuggestion = {
  problem: string;
  businessImpact: string;
  recommendedSolution: string;
};

const RULES: Record<string, OpportunitySuggestion> = {
  NO_WEBSITE: {
    problem: "A empresa não possui um site próprio detectável.",
    businessImpact: "Dependência de canais de terceiros e menor controle sobre aquisição, prova e conversão.",
    recommendedSolution: "Site institucional orientado à conversão",
  },
  INSTAGRAM_TO_WHATSAPP_NO_QUALIFICATION: {
    problem: "O tráfego do Instagram chega ao WhatsApp sem uma etapa clara de qualificação.",
    businessImpact: "O atendimento recebe contatos ainda pouco qualificados e gasta tempo manual antes de entender intenção e contexto.",
    recommendedSolution: "Landing page + qualificação de lead + handoff para WhatsApp",
  },
  POOR_MOBILE_EXPERIENCE: {
    problem: "A experiência mobile apresenta sinais objetivos de fricção.",
    businessImpact: "Usuários podem abandonar o fluxo antes de concluir a ação comercial principal.",
    recommendedSolution: "Otimização mobile e de conversão",
  },
  MISSING_VIEWPORT_META: {
    problem: "A homepage não declara uma configuração de viewport para dispositivos móveis.",
    businessImpact: "Sem essa configuração, navegadores móveis podem renderizar a página usando uma largura virtual de desktop.",
    recommendedSolution: "Correção da base responsiva e revisão mobile-first",
  },
  NO_HOMEPAGE_FORM: {
    problem: "Nenhum formulário foi detectado na homepage.",
    businessImpact: "A homepage não oferece um formulário próprio como caminho de captura ou qualificação de contato.",
    recommendedSolution: "Fluxo de conversão com formulário e qualificação",
  },
  NO_ONLINE_SCHEDULING: {
    problem: "Não foi detectado um fluxo de agendamento online.",
    businessImpact: "O agendamento depende de troca manual de mensagens e aumenta o tempo operacional.",
    recommendedSolution: "Sistema de agendamento integrado",
  },
  NO_HOMEPAGE_SCHEDULING_LINK: {
    problem: "Nenhum link de agendamento online foi detectado na homepage.",
    businessImpact: "A homepage não oferece um atalho detectável para que o visitante marque um horário sem iniciar uma troca manual de mensagens.",
    recommendedSolution: "Agendamento online integrado ao fluxo do site",
  },
  SLOW_WEBSITE: {
    problem: "O site apresenta desempenho abaixo do nível esperado.",
    businessImpact: "Carregamento lento prejudica experiência, conversão e aquisição orgânica.",
    recommendedSolution: "Otimização de performance e conversão",
  },
};

export function detectOpportunity(signal: SignalSnapshot): OpportunitySuggestion | null {
  if (signal.confidence < 0.6) return null;
  return RULES[signal.type] ?? null;
}
