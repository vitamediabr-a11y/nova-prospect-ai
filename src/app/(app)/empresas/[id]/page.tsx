import { notFound } from "next/navigation";
import { ACTIVE_OPPORTUNITY_WHERE } from "@/domain/opportunity-lifecycle";
import { prisma } from "@/lib/prisma";
import { WebsiteAnalyzeButton } from "@/components/website-analyze-button";

const SIGNAL_LABELS: Record<string, string> = {
  NO_WEBSITE: "Site não cadastrado",
  MISSING_VIEWPORT_META: "Meta viewport ausente",
  NO_HOMEPAGE_FORM: "Nenhum formulário na homepage",
  WHATSAPP_PRESENT: "WhatsApp detectado",
  NO_HOMEPAGE_SCHEDULING_LINK: "Agendamento não detectado na homepage",
  ANALYTICS_DETECTED: "Analytics detectado",
  META_PIXEL_DETECTED: "Meta Pixel detectado",
  ECOMMERCE_PLATFORM_DETECTED: "Plataforma de e-commerce detectada",
  CMS_DETECTED: "CMS detectado",
  NO_META_DESCRIPTION: "Meta description ausente",
  NO_STRUCTURED_DATA: "Dados estruturados não detectados",
  INSTAGRAM_TO_WHATSAPP_NO_QUALIFICATION: "Instagram direciona ao WhatsApp sem qualificação",
  POOR_MOBILE_EXPERIENCE: "Fricção mobile detectada",
  NO_ONLINE_SCHEDULING: "Agendamento online não detectado",
  SLOW_WEBSITE: "Desempenho do site abaixo do esperado",
};

const STAGE_LABELS: Record<string, string> = {
  DISCOVERED: "Descoberto",
  QUALIFYING: "Qualificando",
  QUALIFIED: "Qualificado",
  READY_FOR_CONTACT: "Pronto para contato",
  CONTACTED: "Contatado",
  RESPONDED: "Respondeu",
  IN_CONVERSATION: "Em conversa",
  MEETING: "Reunião",
  PROPOSAL: "Proposta",
  WON: "Ganho",
  LOST: "Perdido",
};

const PRIORITY_LABELS: Record<string, string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  URGENT: "Urgente",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function analysisStatusLabel(status: string | null) {
  switch (status) {
    case "COMPLETED": return "Concluída";
    case "NO_WEBSITE": return "Site não cadastrado";
    case "SECURITY_BLOCKED": return "Bloqueada por segurança";
    case "UNREACHABLE": return "Site inacessível na última tentativa";
    case "NOT_ANALYZABLE": return "Conteúdo não analisável";
    default: return "Ainda não analisado";
  }
}

function signalEvidence(type: string) {
  switch (type) {
    case "NO_WEBSITE": return "Nenhum site cadastrado nos dados disponíveis.";
    case "MISSING_VIEWPORT_META": return "Meta viewport não encontrada na homepage.";
    case "NO_HOMEPAGE_FORM": return "Nenhuma tag de formulário encontrada na homepage.";
    case "WHATSAPP_PRESENT": return "Link direto para WhatsApp encontrado na homepage.";
    case "NO_HOMEPAGE_SCHEDULING_LINK": return "Nenhum link de agendamento conhecido encontrado na homepage.";
    case "ANALYTICS_DETECTED": return "Fingerprint de ferramenta de analytics encontrado no HTML.";
    case "META_PIXEL_DETECTED": return "Fingerprint do Meta Pixel encontrado no HTML.";
    case "ECOMMERCE_PLATFORM_DETECTED": return "Fingerprint de plataforma de e-commerce encontrado no HTML.";
    case "CMS_DETECTED": return "Fingerprint de CMS encontrado no HTML.";
    case "NO_META_DESCRIPTION": return "Meta description não encontrada na homepage.";
    case "NO_STRUCTURED_DATA": return "Script application/ld+json não encontrado na homepage.";
    default: return "Evidência estruturada registrada.";
  }
}

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      prospect: true,
      signals: { orderBy: { lastObservedAt: "desc" } },
      opportunities: { where: ACTIVE_OPPORTUNITY_WHERE, orderBy: { score: "desc" } },
    },
  });
  if (!company) notFound();

  const analysis = asRecord(company.websiteAnalysis);
  const analysisStatus = text(analysis?.status);
  const facts = asRecord(analysis?.facts);
  const contacts = asRecord(facts?.contacts);
  const forms = asRecord(facts?.forms);
  const technologies = asArray(facts?.technologies).map(asRecord).filter((item): item is Record<string, unknown> => item !== null);
  const currentOpportunities = company.opportunities;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Empresa</p>
          <h1>{company.displayName}</h1>
          <p className="subtle">{company.industry ?? "Segmento não informado"}{company.location ? ` · ${company.location}` : ""}</p>
        </div>
        <WebsiteAnalyzeButton companyId={company.id} />
      </header>

      <div className="detail-grid">
        <div>
          <section className="section intelligence-section">
            <div className="section-heading"><h2>Site</h2><span className="subtle">{analysisStatusLabel(analysisStatus)}</span></div>
            <dl className="facts">
              <div className="fact"><dt>URL cadastrada</dt><dd>{company.website ?? "Não informado"}</dd></div>
              <div className="fact"><dt>URL final</dt><dd>{text(facts?.finalUrl) ?? "—"}</dd></div>
              <div className="fact"><dt>HTTP</dt><dd>{numberValue(facts?.status) ?? "—"}</dd></div>
              <div className="fact"><dt>HTTPS</dt><dd>{facts?.https === true ? "Sim" : facts?.https === false ? "Não" : "—"}</dd></div>
              <div className="fact"><dt>Tipo</dt><dd>{text(facts?.contentType) ?? "—"}</dd></div>
              <div className="fact"><dt>Última análise</dt><dd>{company.websiteAnalyzedAt ? company.websiteAnalyzedAt.toLocaleString("pt-BR") : "—"}</dd></div>
            </dl>
            {text(analysis?.message) ? <p className="analysis-note">{text(analysis?.message)}</p> : null}
          </section>

          <section className="section intelligence-section">
            <div className="section-heading"><h2>Contato detectado</h2></div>
            <dl className="facts">
              <div className="fact"><dt>WhatsApp</dt><dd>{asArray(contacts?.whatsappLinks).length > 0 ? "Detectado" : "Não detectado na homepage"}</dd></div>
              <div className="fact"><dt>Telefone</dt><dd>{asArray(contacts?.phoneLinks).length > 0 ? "Detectado" : "Não detectado na homepage"}</dd></div>
              <div className="fact"><dt>E-mail</dt><dd>{asArray(contacts?.emailLinks).length > 0 ? "Detectado" : "Não detectado na homepage"}</dd></div>
              <div className="fact"><dt>Formulário</dt><dd>{numberValue(forms?.count) !== null ? `${numberValue(forms?.count)} encontrado(s)` : "—"}</dd></div>
              <div className="fact"><dt>Agendamento</dt><dd>{asArray(contacts?.schedulingLinks).length > 0 ? "Detectado" : "Não detectado na homepage"}</dd></div>
            </dl>
          </section>

          <section className="section intelligence-section">
            <div className="section-heading"><h2>Tecnologias detectadas</h2><span className="subtle">{technologies.length}</span></div>
            {technologies.length === 0 ? (
              <div className="empty">Nenhum fingerprint de tecnologia foi confirmado na última análise concluída.</div>
            ) : (
              <div className="compact-list">
                {technologies.map((technology, index) => (
                  <div className="compact-row" key={`${text(technology.technology) ?? "tecnologia"}-${index}`}>
                    <div><strong>{text(technology.technology) ?? "Tecnologia"}</strong><span>{text(technology.evidence) ?? "Evidência registrada"}</span></div>
                    <span className="score">{numberValue(technology.confidence) !== null ? `${Math.round((numberValue(technology.confidence) ?? 0) * 100)}%` : "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="section intelligence-section">
            <div className="section-heading"><h2>Sinais encontrados</h2><span className="subtle">{company.signals.length}</span></div>
            {company.signals.length === 0 ? (
              <div className="empty">Ainda não há sinais registrados para esta empresa.</div>
            ) : (
              <div className="compact-list">
                {company.signals.map((signal) => (
                  <div className="compact-row signal-row" key={signal.id}>
                    <div>
                      <strong>{SIGNAL_LABELS[signal.type] ?? signal.type}</strong>
                      <span>{signalEvidence(signal.type)}</span>
                      <span>Observado em {signal.lastObservedAt.toLocaleString("pt-BR")}</span>
                    </div>
                    <div className="signal-state">
                      <span className="score">{Math.round(signal.confidence * 100)}%</span>
                      <span className={signal.resolvedAt ? "state-pill resolved" : "state-pill"}>{signal.resolvedAt ? "Resolvido" : "Atual"}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside>
          <div className="section-heading"><h2>Estado comercial</h2></div>
          <dl className="facts">
            <div className="fact"><dt>Estágio</dt><dd>{company.prospect ? STAGE_LABELS[company.prospect.stage] ?? company.prospect.stage : "—"}</dd></div>
            <div className="fact"><dt>Oportunidades</dt><dd>{currentOpportunities.length}</dd></div>
            <div className="fact"><dt>Melhor score</dt><dd>{currentOpportunities[0]?.score ?? "—"}</dd></div>
            <div className="fact"><dt>Contato</dt><dd>{company.doNotContact ? "NÃO CONTATAR" : "Permitido pelas regras atuais"}</dd></div>
          </dl>
          <section className="section"><div className="section-heading"><h2>Contexto conhecido</h2></div><dl className="facts"><div className="fact"><dt>Instagram</dt><dd>{company.instagram ? `@${company.instagram}` : "Não informado"}</dd></div><div className="fact"><dt>WhatsApp</dt><dd>{company.whatsapp ?? "Não informado"}</dd></div><div className="fact"><dt>E-mail</dt><dd>{company.email ?? "Não informado"}</dd></div></dl></section>
        </aside>
      </div>

      <section className="section intelligence-section">
        <div className="section-heading"><h2>Oportunidades</h2><span className="subtle">{currentOpportunities.length}</span></div>
        {currentOpportunities.length === 0 ? (
          <div className="empty">Nenhuma oportunidade determinística foi derivada dos sinais atuais.</div>
        ) : (
          <div className="opportunity-list">
            {currentOpportunities.map((opportunity) => {
              const breakdown = asRecord(opportunity.scoreBreakdown);
              return (
                <article className="opportunity-row" key={opportunity.id}>
                  <div className="opportunity-main">
                    <strong>{opportunity.problem}</strong>
                    <p>{opportunity.businessImpact}</p>
                    <p><span>Solução Nova Web:</span> {opportunity.recommendedSolution}</p>
                    <small>{text(breakdown?.explanation) ?? "Score calculado por regras determinísticas."}</small>
                  </div>
                  <div className="opportunity-score"><strong>{opportunity.score}</strong><span>{PRIORITY_LABELS[opportunity.priority] ?? opportunity.priority}</span></div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
