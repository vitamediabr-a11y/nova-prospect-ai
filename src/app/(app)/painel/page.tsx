import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function DashboardPage() {
  const [companies, opportunities, qualified, awaitingHuman, replies, highScore] = await Promise.all([
    prisma.company.count(),
    prisma.opportunity.count(),
    prisma.prospect.count({ where: { stage: { in: ["QUALIFIED", "READY_FOR_CONTACT"] } } }),
    prisma.conversation.count({ where: { status: "NEEDS_HUMAN" } }),
    prisma.conversation.findMany({
      where: { status: "NEEDS_HUMAN" },
      orderBy: { respondedAt: "desc" },
      take: 5,
      include: { prospect: { include: { company: true } } },
    }),
    prisma.opportunity.findMany({
      where: { status: { in: ["OPEN", "REVIEW", "READY"] }, score: { gte: 70 }, company: { doNotContact: false } },
      orderBy: [{ score: "desc" }, { createdAt: "asc" }],
      take: 5,
      include: { company: true },
    }),
  ]);

  return (
    <div className="page">
      <header className="page-header">
        <div><p className="eyebrow">Operação</p><h1>O que precisa de atenção</h1></div>
        <Link className="button primary" href="/empresas/nova">Cadastrar empresa</Link>
      </header>

      <section className="metric-strip" aria-label="Indicadores principais">
        <div className="metric"><strong>{companies}</strong><span>empresas descobertas</span></div>
        <div className="metric"><strong>{opportunities}</strong><span>oportunidades</span></div>
        <div className="metric"><strong>{qualified}</strong><span>prontas para avançar</span></div>
        <div className="metric"><strong>{awaitingHuman}</strong><span>respostas aguardando humano</span></div>
      </section>

      <section className="section">
        <div className="section-heading"><h2>Respostas aguardando atendimento</h2></div>
        {replies.length === 0 ? <div className="empty">Nenhuma resposta aguardando atendimento.</div> : (
          <div className="data-list">
            <div className="data-row header"><span>Empresa</span><span>Resposta</span><span>Quando</span><span>Ação</span></div>
            {replies.map((reply) => <div className="data-row" key={reply.id}><strong>{reply.prospect.company.displayName}</strong><span>{reply.responsePreview ?? "Resposta recebida"}</span><span className="status">{reply.respondedAt.toLocaleDateString("pt-BR")}</span><Link href={`/empresas/${reply.prospect.company.id}`}>Ver contexto</Link></div>)}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-heading"><h2>Leads com score alto sem avanço</h2></div>
        {highScore.length === 0 ? <div className="empty">Nenhuma oportunidade com score alto pendente.</div> : (
          <div className="data-list">
            <div className="data-row header"><span>Empresa</span><span>Problema</span><span>Score</span><span>Ação</span></div>
            {highScore.map((item) => <div className="data-row" key={item.id}><strong>{item.company.displayName}</strong><span>{item.problem}</span><span className="score">{item.score}</span><Link href={`/empresas/${item.companyId}`}>Abrir</Link></div>)}
          </div>
        )}
      </section>
    </div>
  );
}
