import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      prospect: true,
      signals: { orderBy: { detectedAt: "desc" } },
      opportunities: { orderBy: { score: "desc" } },
    },
  });
  if (!company) notFound();

  return (
    <div className="page">
      <header className="page-header"><div><p className="eyebrow">Empresa</p><h1>{company.displayName}</h1><p className="subtle">{company.industry ?? "Segmento não informado"}{company.location ? ` · ${company.location}` : ""}</p></div></header>
      <div className="detail-grid">
        <section>
          <div className="section-heading"><h2>Contexto conhecido</h2></div>
          <dl className="facts">
            <div className="fact"><dt>Site</dt><dd>{company.website ?? "Não informado"}</dd></div>
            <div className="fact"><dt>Instagram</dt><dd>{company.instagram ? `@${company.instagram}` : "Não informado"}</dd></div>
            <div className="fact"><dt>WhatsApp</dt><dd>{company.whatsapp ?? "Não informado"}</dd></div>
            <div className="fact"><dt>E-mail</dt><dd>{company.email ?? "Não informado"}</dd></div>
            <div className="fact"><dt>Origem</dt><dd>{company.source}</dd></div>
            <div className="fact"><dt>Contato</dt><dd>{company.doNotContact ? "NÃO CONTATAR" : "Permitido pelas regras atuais"}</dd></div>
          </dl>
          <section className="section"><div className="section-heading"><h2>Sinais detectados</h2><span className="subtle">{company.signals.length}</span></div>{company.signals.length === 0 ? <div className="empty">Ainda não há análise ou sinal registrado para esta empresa.</div> : company.signals.map((signal) => <div className="data-list" key={signal.id}><div className="data-row"><strong>{signal.type}</strong><span>{signal.source}</span><span className="score">{Math.round(signal.confidence * 100)}%</span><span>{signal.detectedAt.toLocaleDateString("pt-BR")}</span></div></div>)}</section>
        </section>
        <aside>
          <div className="section-heading"><h2>Estado comercial</h2></div>
          <dl className="facts"><div className="fact"><dt>Estágio</dt><dd>{company.prospect?.stage ?? "—"}</dd></div><div className="fact"><dt>Oportunidades</dt><dd>{company.opportunities.length}</dd></div><div className="fact"><dt>Melhor score</dt><dd>{company.opportunities[0]?.score ?? "—"}</dd></div></dl>
          <section className="section"><div className="section-heading"><h2>Próximo passo</h2></div><p className="subtle">{company.signals.length === 0 ? "Executar enriquecimento e análise objetiva do site antes de gerar uma abordagem." : company.opportunities.length === 0 ? "Transformar sinais confirmados em uma oportunidade explicável." : "Revisar evidências e preparar a primeira abordagem."}</p></section>
        </aside>
      </div>
    </div>
  );
}
