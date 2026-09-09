CREATE TABLE "commercial_analyses" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "generationPurpose" TEXT NOT NULL DEFAULT 'FIRST_MESSAGE',
  "inputFingerprint" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "commercialInterpretation" TEXT NOT NULL,
  "messageDraft" TEXT NOT NULL,
  "evidenceReferences" JSONB NOT NULL,
  "confidence" TEXT NOT NULL,
  "warnings" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SUCCESS',
  "createdById" TEXT NOT NULL,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commercial_analyses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "commercial_analyses_companyId_createdAt_idx"
ON "commercial_analyses"("companyId", "createdAt");

CREATE INDEX "commercial_analyses_companyId_opportunityId_inputFingerprint_status_createdAt_idx"
ON "commercial_analyses"("companyId", "opportunityId", "inputFingerprint", "status", "createdAt");

CREATE INDEX "commercial_analyses_createdById_createdAt_idx"
ON "commercial_analyses"("createdById", "createdAt");

ALTER TABLE "commercial_analyses"
ADD CONSTRAINT "commercial_analyses_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "commercial_analyses"
ADD CONSTRAINT "commercial_analyses_opportunityId_fkey"
FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_analyses"
ADD CONSTRAINT "commercial_analyses_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
