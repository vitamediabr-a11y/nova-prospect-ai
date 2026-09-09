-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN "resolvedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "opportunities_companyId_resolvedAt_idx" ON "opportunities"("companyId", "resolvedAt");
