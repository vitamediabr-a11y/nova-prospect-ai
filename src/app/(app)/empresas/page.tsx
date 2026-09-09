import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function CompaniesPage() {
  const companies = await prisma.company.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      prospect: true,
      opportunities: { where: { status: { in: ["OPEN", "REVIEW", "READY"] } }, orderBy: { score: "desc" }, take: 1 },
    },
  });

  return (
    <div className="page">
      <header className="page-header">
        <div><p className="eyebrow">Prospecção</p><h1>Empresas</h1><p className="subtle">Fonte real de empresas já ingeridas pelo sistema.</p></div>
        <Link className="button primary" href="/empresas/nova">Cadastrar empresa</Link>
      </header>
      {companies.length === 0 ? <div className="empty">Nenhuma empresa cadastrada. Comece por uma empresa real para validar o fluxo.</div> : (
        <div className="data-list">
          <div className="data-row header"><span>Empresa</span><span>Estágio</span><span>Score</span><span>Origem</span></div>
          {companies.map((company) => <Link className="data-row" key={company.id} href={`/empresas/${company.id}`}><strong>{company.displayName}</strong><span>{company.prospect?.stage ?? "—"}</span><span className="score">{company.opportunities[0]?.score ?? "—"}</span><span className="status">{company.source}</span></Link>)}
        </div>
      )}
    </div>
  );
}
