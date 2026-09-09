ALTER TYPE "CompanySource" ADD VALUE 'WEB_SEARCH';

CREATE TYPE "DiscoveryRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

ALTER TABLE "companies"
ADD COLUMN "displayNameProvisional" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "discovery_runs" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "segment" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "additionalTerms" TEXT,
  "query" TEXT NOT NULL,
  "status" "DiscoveryRunStatus" NOT NULL DEFAULT 'PENDING',
  "requestedLimit" INTEGER NOT NULL,
  "providerRequests" INTEGER NOT NULL DEFAULT 0,
  "candidatesFound" INTEGER NOT NULL DEFAULT 0,
  "candidatesAccepted" INTEGER NOT NULL DEFAULT 0,
  "newCompanies" INTEGER NOT NULL DEFAULT 0,
  "duplicatesSkipped" INTEGER NOT NULL DEFAULT 0,
  "rejectedCandidates" INTEGER NOT NULL DEFAULT 0,
  "failedCandidates" INTEGER NOT NULL DEFAULT 0,
  "securityBlocked" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "discovery_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "discovery_runs_idempotencyKey_key" ON "discovery_runs"("idempotencyKey");
CREATE INDEX "discovery_runs_createdById_createdAt_idx" ON "discovery_runs"("createdById", "createdAt");
CREATE INDEX "discovery_runs_status_createdAt_idx" ON "discovery_runs"("status", "createdAt");

ALTER TABLE "discovery_runs"
ADD CONSTRAINT "discovery_runs_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
