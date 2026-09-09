import "./discovery.css";
import Link from "next/link";
import { DiscoveryForm } from "@/components/discovery-form";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/prisma";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value : null;
}

function statusLabel(input: { outcome: string | null; analysisStatus: string | null }) {
  if (input.analysisStatus === "ANALYSIS_FAILED") return "Falha na análise";
  if (input.outcome === "NEW") return "Nova";
  if (input.analysisStatus === "ANALYZED") return "Analisada";
  return "Já existente";
}

function runStatusLabel(status: string) {
  switch (status) {
    case "RUNNING": return "Em execução";
    case "COMPLETED": return "Concluída";
    case "PARTIAL": return "Concluída parcialmente";
    case "FAILED": return "Falhou";
    default: return "Pendente";
  }
}

export default async function DiscoveryPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const session = await requireSession();
  const { run: runId } = await searchParams;
  const configured = Boolean(process.env.BRAVE_SEARCH_API_KEY?.trim());
  const recentRuns = await prisma.discoveryRun.findMany({
    where: { createdById: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  const selectedRun = runId
    ? recentRuns.find((run) => run.id === runId) ?? await prisma.discoveryRun.findFirst({ where: { id: runId, createdById: session.user.id } })
    : recentRuns[0] ?? null;

  let acceptedRows: Array<{
    companyId: string;
    outcome: string | null;
    analysisStatus: string | null;
    provisional: boolean;
  }> = [];

  if (selectedRun) {
    const acceptanceLogs = await prisma.auditLog.findMany({
      where: { action: "discovery.company.accepted" },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    acceptedRows = acceptanceLogs.flatMap((log) => {
      const metadata = asRecord(log.metadata);
      if (text(metadata?.discoveryRunId) !== selectedRun.id) return [];
      return [{
        companyId: log.entityId,
        outcome: text(metadata?.outcome),
        analysisStatus: text(metadata?.analysisStatus),
        provisional: metadata?.provisional === true,
      }];
    });
  }

  const companies = acceptedRows.length > 0
    ? await prisma.company.findMany({
        where: { id: { in: acceptedRows.map((row) => row.companyId) } },
        include: {
          opportunities: {
            where: { resolvedAt: null },
            orderBy: [{ score: "desc" }, { createdAt: "asc" }],
            take: 1,
          },
        },
      })
    : [];
  const companyById = new Map(companies.map((company) => [company.id, company]));

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Descoberta</p>
          <h1>Encontrar empresas na web</h1>
          <p className="subtle">Busca autorizada → verificação do site → empresa → inteligência comercial.</p>
        </div>
      </header>

      {!configured ? (
        <div className="connection-banner">
          <strong>Conexão necessária</strong>
          <span>Configure `BRAVE_SEARCH_API_KEY` no servidor para habilitar novas buscas. O restante do sistema continua operacional.</span>
        </div>
      ) : null}

      <section className="section discovery-search-section">
        <div className="section-heading"><h2>Nova busca</h2><span className="subtle">Máximo de 20 resultados por execução</span></div>
        <DiscoveryForm configured={configured} />
      </section>

      {selectedRun ? (
        <>
          <section className="section">
            <div className="section-heading">
              <div>
                <h2>Resultado da busca</h2>
                <p className="subtle discovery-query">{selectedRun.segment} · {selectedRun.location}{selectedRun.additionalTerms ? ` · ${selectedRun.additionalTerms}` : ""}</p>
              </div>
              <span className="state-pill">{runStatusLabel(selectedRun.status)}</span>
            </div>
            <p className="subtle">Fonte de descoberta: Brave Search. Os fatos exibidos abaixo vêm dos sites verificados, não de snippets do provedor.</p>
            <div className="discovery-metrics">
              <div><strong>{selectedRun.candidatesFound}</strong><span>URLs retornadas transitoriamente</span></div>
              <div><strong>{selectedRun.candidatesAccepted}</strong><span>sites comerciais verificados</span></div>
              <div><strong>{selectedRun.newCompanies}</strong><span>novas empresas</span></div>
              <div><strong>{selectedRun.duplicatesSkipped}</strong><span>já conhecidas ou duplicadas</span></div>
              <div><strong>{selectedRun.failedCandidates}</strong><span>falhas de verificação/análise</span></div>
              <div><strong>{selectedRun.securityBlocked}</strong><span>bloqueadas por segurança</span></div>
            </div>
            {selectedRun.errorMessage ? <p className="form-error discovery-run-error">{selectedRun.errorMessage}</p> : null}
          </section>

          <section className="section">
            <div className="section-heading"><h2>Empresas aceitas</h2><span className="subtle">{acceptedRows.length}</span></div>
            {acceptedRows.length === 0 ? (
              <div className="empty">Nenhuma empresa verificada foi aceita nesta busca.</div>
            ) : (
              <div className="discovery-company-list">
                {acceptedRows.map((row) => {
                  const company = companyById.get(row.companyId);
                  if (!company) return null;
                  const topOpportunity = company.opportunities[0] ?? null;
                  return (
                    <article className="discovery-company-row" key={`${selectedRun.id}-${company.id}`}>
                      <div className="discovery-company-main">
                        <div className="discovery-company-title">
                          <strong>{company.displayName}</strong>
                          {company.displayNameProvisional || row.provisional ? <span className="state-pill resolved">Identidade provisória</span> : null}
                        </div>
                        <span>{company.website ?? "Site não informado"}</span>
                        <span>{[company.industry, company.location].filter(Boolean).join(" · ") || "Segmento/localização não confirmados no site"}</span>
                        {topOpportunity ? <span className="discovery-opportunity">{topOpportunity.problem}</span> : <span>Nenhuma oportunidade ativa derivada.</span>}
                      </div>
                      <div className="discovery-company-status">
                        <span className="state-pill">{statusLabel(row)}</span>
                        <strong className="score">{topOpportunity?.score ?? "—"}</strong>
                        <Link className="button" href={`/empresas/${company.id}`}>Abrir empresa</Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="section"><div className="empty">Nenhuma busca executada ainda.</div></section>
      )}

      {recentRuns.length > 1 ? (
        <section className="section">
          <div className="section-heading"><h2>Buscas recentes</h2></div>
          <div className="compact-list">
            {recentRuns.map((run) => (
              <Link className="compact-row" href={`/descoberta?run=${run.id}`} key={run.id}>
                <div><strong>{run.segment} · {run.location}</strong><span>{run.createdAt.toLocaleString("pt-BR")}</span></div>
                <span>{runStatusLabel(run.status)}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
