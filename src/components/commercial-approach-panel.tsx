"use client";

import { useMemo, useState, useTransition } from "react";
import { generateCommercialApproach } from "@/server/ai/actions";
import type { CommercialAnalysisView } from "@/server/ai/service";
import { createFirstContactDraft } from "@/server/contacts/actions";

const CHANNEL_LABELS = {
  WHATSAPP: "WhatsApp",
  EMAIL: "E-mail",
  INSTAGRAM: "Instagram",
  PHONE: "Telefone",
  OTHER: "Outro",
} as const;

type ContactChannel = keyof typeof CHANNEL_LABELS;

type OpportunityView = {
  id: string;
  problem: string;
  businessImpact: string;
  recommendedSolution: string;
  score: number;
  scoreExplanation: string;
  priority: string;
};

export function CommercialApproachPanel(props: {
  companyId: string;
  prospectId: string | null;
  inputFingerprint: string;
  activeOpportunity: OpportunityView | null;
  latestAnalysis: CommercialAnalysisView | null;
  defaultChannel: ContactChannel;
  aiConfigured: boolean;
  suppressed: boolean;
}) {
  const initialCurrent = props.latestAnalysis && !props.latestAnalysis.stale ? props.latestAnalysis : null;
  const [analysis, setAnalysis] = useState<CommercialAnalysisView | null>(initialCurrent);
  const [message, setMessage] = useState(initialCurrent?.messageDraft ?? "");
  const [channel, setChannel] = useState<ContactChannel>(props.defaultChannel);
  const [editing, setEditing] = useState(!initialCurrent);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [pending, startTransition] = useTransition();

  const selectedOpportunity = useMemo(() => {
    if (analysis && !analysis.stale && props.activeOpportunity?.id === analysis.opportunityId) return props.activeOpportunity;
    return props.activeOpportunity;
  }, [analysis, props.activeOpportunity]);

  function generate(regenerate: boolean) {
    setFeedback(null);
    setFeedbackError(false);
    startTransition(async () => {
      const result = await generateCommercialApproach({ companyId: props.companyId, regenerate });
      if (!result.ok) {
        setFeedback(result.message);
        setFeedbackError(true);
        return;
      }
      setAnalysis(result.analysis);
      setMessage(result.analysis.messageDraft);
      setEditing(false);
      setPrepared(false);
      setFeedback(result.reused ? "Abordagem atual reutilizada porque as evidências não mudaram." : "Abordagem gerada com as evidências atuais.");
    });
  }

  function prepareContact() {
    if (!props.prospectId || !selectedOpportunity) {
      setFeedback("Não há prospect e oportunidade atual disponíveis para preparar o contato.");
      setFeedbackError(true);
      return;
    }
    const trimmed = message.trim();
    if (trimmed.length < 20) {
      setFeedback("A abordagem precisa ter pelo menos 20 caracteres.");
      setFeedbackError(true);
      return;
    }
    if (trimmed.length > 500) {
      setFeedback("A primeira mensagem precisa ter no máximo 500 caracteres nesta etapa.");
      setFeedbackError(true);
      return;
    }

    setFeedback(null);
    setFeedbackError(false);
    startTransition(async () => {
      const currentAnalysis = analysis && !analysis.stale ? analysis : null;
      const result = await createFirstContactDraft({
        prospectId: props.prospectId!,
        opportunityId: selectedOpportunity.id,
        channel,
        messageDraft: trimmed,
        evidence: {
          source: currentAnalysis ? "AI_COMMERCIAL_ANALYSIS" : "MANUAL_COMMERCIAL_DRAFT",
          commercialAnalysisId: currentAnalysis?.id ?? null,
          inputFingerprint: props.inputFingerprint,
        },
      });
      if (!result.ok) {
        setFeedback(result.message);
        setFeedbackError(true);
        return;
      }
      setPrepared(true);
      setEditing(false);
      setFeedback("Rascunho preparado. O contato permanece em DRAFT e ainda não foi aprovado nem enviado.");
    });
  }

  if (props.suppressed) {
    return (
      <section className="section approach-section">
        <div className="section-heading"><h2>Abordagem</h2><span className="state-pill resolved">Bloqueada</span></div>
        <div className="empty">Contato bloqueado pelas regras de supressão.</div>
      </section>
    );
  }

  if (!props.activeOpportunity) {
    return (
      <section className="section approach-section">
        <div className="section-heading"><h2>Abordagem</h2></div>
        <div className="empty">Nenhuma oportunidade atual para abordagem.</div>
      </section>
    );
  }

  const visibleAnalysis = analysis ?? props.latestAnalysis;
  const stale = Boolean(visibleAnalysis?.stale && !analysis);

  return (
    <section className="section approach-section">
      <div className="section-heading">
        <div>
          <h2>Abordagem</h2>
          <p className="subtle approach-heading-note">Leitura comercial e primeira mensagem apoiadas apenas nas evidências atuais.</p>
        </div>
        {stale ? <span className="state-pill resolved">Desatualizada</span> : analysis ? <span className="state-pill">IA atual</span> : null}
      </div>

      {!props.aiConfigured ? (
        <div className="connection-banner approach-connection">
          <strong>IA não configurada</strong>
          <span>Configure GEMINI_API_KEY no servidor para gerar a leitura comercial. O rascunho manual continua disponível.</span>
        </div>
      ) : null}

      <div className="approach-grid">
        <div className="approach-block">
          <span className="approach-label">Melhor oportunidade</span>
          <strong>{props.activeOpportunity.problem}</strong>
          <p>{props.activeOpportunity.recommendedSolution}</p>
          <div className="approach-score-row"><span>Lead Score</span><strong>{props.activeOpportunity.score}</strong></div>
        </div>

        <div className="approach-block">
          <span className="approach-label">Leitura comercial</span>
          {visibleAnalysis && !stale ? (
            <>
              <p>{visibleAnalysis.commercialInterpretation}</p>
              <div className="approach-confidence"><span>Confiança da IA</span><strong>{visibleAnalysis.confidence}</strong></div>
            </>
          ) : stale && visibleAnalysis ? (
            <p className="subtle">A leitura anterior ficou desatualizada porque as evidências determinísticas mudaram. Gere novamente antes de reutilizá-la.</p>
          ) : (
            <p className="subtle">Ainda não há leitura gerada. O score acima continua sendo exclusivamente determinístico.</p>
          )}
        </div>
      </div>

      <div className="approach-evidence">
        <span className="approach-label">Evidências usadas</span>
        {visibleAnalysis && !stale && visibleAnalysis.evidenceFacts.length > 0 ? (
          <ul>{visibleAnalysis.evidenceFacts.map((item) => <li key={item.ref}>{item.fact}</li>)}</ul>
        ) : (
          <p className="subtle">As evidências aparecem aqui após uma geração válida e atual.</p>
        )}
      </div>

      <div className="approach-message">
        <div className="approach-message-header">
          <div><span className="approach-label">Primeira mensagem sugerida</span><small>{message.length}/500</small></div>
          <label>
            Canal
            <select value={channel} onChange={(event) => setChannel(event.target.value as ContactChannel)} disabled={pending || prepared}>
              {Object.entries(CHANNEL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value.slice(0, 500))}
          maxLength={500}
          readOnly={!editing || prepared}
          placeholder="Escreva manualmente uma observação curta e factual ou gere uma abordagem com IA."
          aria-label="Primeira mensagem de abordagem"
        />
      </div>

      <div className="approach-actions">
        {props.aiConfigured ? (
          analysis || visibleAnalysis ? (
            <button className="button" type="button" onClick={() => generate(true)} disabled={pending || prepared}>Gerar novamente</button>
          ) : (
            <button className="button" type="button" onClick={() => generate(false)} disabled={pending || prepared}>Gerar abordagem</button>
          )
        ) : null}
        <button className="button" type="button" onClick={() => setEditing(true)} disabled={pending || prepared || editing}>Editar</button>
        <button className="button primary" type="button" onClick={prepareContact} disabled={pending || prepared || message.trim().length < 20}>
          {prepared ? "Contato preparado" : "Preparar contato"}
        </button>
      </div>

      {feedback ? <p className={feedbackError ? "action-feedback error approach-feedback" : "action-feedback approach-feedback"} role="status" aria-live="polite">{feedback}</p> : null}
    </section>
  );
}
