"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startDiscovery, type DiscoveryActionResult } from "@/server/discovery/actions";

export function DiscoveryForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [segment, setSegment] = useState("");
  const [location, setLocation] = useState("");
  const [additionalTerms, setAdditionalTerms] = useState("");
  const [limit, setLimit] = useState(10);
  const [result, setResult] = useState<DiscoveryActionResult | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    startTransition(async () => {
      const next = await startDiscovery({ segment, location, additionalTerms, limit });
      setResult(next);
      if (next.runId) router.replace(`/descoberta?run=${next.runId}`);
      router.refresh();
    });
  }

  return (
    <form className="discovery-form" onSubmit={submit}>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="segment">Segmento</label>
          <input
            id="segment"
            value={segment}
            onChange={(event) => setSegment(event.target.value)}
            placeholder="clínica odontológica"
            maxLength={120}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="location">Localização</label>
          <input
            id="location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Belém, PA"
            maxLength={120}
            required
          />
        </div>
      </div>
      <div className="field-grid discovery-secondary-fields">
        <div className="field">
          <label htmlFor="additionalTerms">Palavras adicionais <span className="subtle">(opcional)</span></label>
          <input
            id="additionalTerms"
            value={additionalTerms}
            onChange={(event) => setAdditionalTerms(event.target.value)}
            placeholder="implantes"
            maxLength={120}
          />
        </div>
        <div className="field">
          <label htmlFor="limit">Quantidade</label>
          <select id="limit" value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
            <option value={5}>5 resultados</option>
            <option value={10}>10 resultados</option>
          </select>
        </div>
      </div>
      <div className="discovery-form-footer">
        <p className="subtle">Uma busca por execução. Resultados do provedor são transitórios; só sites verificados entram no sistema.</p>
        <button className="button primary" type="submit" disabled={pending || !configured}>
          {pending ? "Buscando e verificando…" : configured ? "Buscar empresas" : "Conexão necessária"}
        </button>
      </div>
      {result ? (
        <p className={result.ok ? "action-feedback discovery-feedback" : "action-feedback error discovery-feedback"} role="status" aria-live="polite">
          {result.message}
        </p>
      ) : null}
    </form>
  );
}
