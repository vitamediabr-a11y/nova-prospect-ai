"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { analyzeCompanyWebsite, type AnalyzeCompanyWebsiteResult } from "@/server/website/actions";

export function WebsiteAnalyzeButton({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AnalyzeCompanyWebsiteResult | null>(null);

  function runAnalysis() {
    setResult(null);
    startTransition(async () => {
      const next = await analyzeCompanyWebsite({ companyId });
      setResult(next);
      router.refresh();
    });
  }

  return (
    <div className="analysis-action">
      <button className="button primary" type="button" onClick={runAnalysis} disabled={pending}>
        {pending ? "Analisando…" : "Analisar site"}
      </button>
      {result ? (
        <p className={result.ok ? "action-feedback" : "action-feedback error"} role="status" aria-live="polite">
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
