-- AlterTable
ALTER TABLE "companies"
ADD COLUMN "websiteAnalysis" JSONB,
ADD COLUMN "websiteAnalyzedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "signals"
ADD COLUMN "lastObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "resolvedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "opportunities"
ADD COLUMN "dedupeKey" TEXT;

-- CreateIndex
CREATE INDEX "signals_companyId_resolvedAt_idx" ON "signals"("companyId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_dedupeKey_key" ON "opportunities"("dedupeKey");
