-- CreateEnum
CREATE TYPE "CompanySource" AS ENUM ('MANUAL', 'CSV', 'WEBSITE', 'GOOGLE_MAPS', 'GOOGLE_SEARCH', 'DIRECTORY', 'INSTAGRAM', 'WHATSAPP', 'EMAIL', 'OTHER');

-- CreateEnum
CREATE TYPE "ProspectStage" AS ENUM ('DISCOVERED', 'QUALIFYING', 'QUALIFIED', 'READY_FOR_CONTACT', 'CONTACTED', 'RESPONDED', 'IN_CONVERSATION', 'MEETING', 'PROPOSAL', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "OpportunityPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('OPEN', 'REVIEW', 'READY', 'CONTACTED', 'RESPONDED', 'WON', 'LOST', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('INSTAGRAM', 'WHATSAPP', 'EMAIL', 'PHONE', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactAttemptStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENT', 'DELIVERED', 'FAILED', 'RESPONDED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('NEEDS_HUMAN', 'IN_PROGRESS', 'WAITING_PROSPECT', 'CLOSED');

-- CreateEnum
CREATE TYPE "DomainEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icps" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "industries" JSONB,
    "locations" JSONB,
    "followerRanges" JSONB,
    "businessSignals" JSONB,
    "requiredConditions" JSONB,
    "excludedConditions" JSONB,
    "preferredSolutions" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "icps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT,
    "website" TEXT,
    "instagram" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "location" TEXT,
    "industry" TEXT,
    "employeeEstimate" INTEGER,
    "source" "CompanySource" NOT NULL,
    "sourceRef" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "socialSignals" JSONB,
    "technologySignals" JSONB,
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "processingPurpose" TEXT NOT NULL DEFAULT 'prospeccao_b2b',
    "retentionUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospects" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "stage" "ProspectStage" NOT NULL DEFAULT 'DISCOVERED',
    "ownerId" TEXT,
    "suppressedAt" TIMESTAMP(3),
    "suppressionReason" TEXT,
    "lastContactAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prospects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "signalId" TEXT,
    "ownerId" TEXT,
    "problem" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "businessImpact" TEXT NOT NULL,
    "recommendedSolution" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "scoreBreakdown" JSONB NOT NULL,
    "priority" "OpportunityPriority" NOT NULL,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_attempts" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "channel" "ContactChannel" NOT NULL,
    "messageDraft" TEXT NOT NULL,
    "messageFinal" TEXT,
    "evidence" JSONB NOT NULL,
    "status" "ContactAttemptStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "contactAttemptId" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'NEEDS_HUMAN',
    "responsePreview" TEXT,
    "respondedAt" TIMESTAMP(3) NOT NULL,
    "humanTakenOverAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "uniqueKey" TEXT NOT NULL,
    "status" "DomainEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "icps_active_idx" ON "icps"("active");

-- CreateIndex
CREATE UNIQUE INDEX "companies_dedupeKey_key" ON "companies"("dedupeKey");

-- CreateIndex
CREATE INDEX "companies_source_idx" ON "companies"("source");

-- CreateIndex
CREATE INDEX "companies_industry_idx" ON "companies"("industry");

-- CreateIndex
CREATE INDEX "companies_doNotContact_idx" ON "companies"("doNotContact");

-- CreateIndex
CREATE UNIQUE INDEX "prospects_companyId_key" ON "prospects"("companyId");

-- CreateIndex
CREATE INDEX "prospects_stage_idx" ON "prospects"("stage");

-- CreateIndex
CREATE INDEX "prospects_ownerId_idx" ON "prospects"("ownerId");

-- CreateIndex
CREATE INDEX "prospects_suppressedAt_idx" ON "prospects"("suppressedAt");

-- CreateIndex
CREATE UNIQUE INDEX "signals_dedupeKey_key" ON "signals"("dedupeKey");

-- CreateIndex
CREATE INDEX "signals_companyId_detectedAt_idx" ON "signals"("companyId", "detectedAt");

-- CreateIndex
CREATE INDEX "signals_type_idx" ON "signals"("type");

-- CreateIndex
CREATE INDEX "opportunities_companyId_status_idx" ON "opportunities"("companyId", "status");

-- CreateIndex
CREATE INDEX "opportunities_score_idx" ON "opportunities"("score");

-- CreateIndex
CREATE INDEX "opportunities_ownerId_idx" ON "opportunities"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "contact_attempts_idempotencyKey_key" ON "contact_attempts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "contact_attempts_prospectId_status_idx" ON "contact_attempts"("prospectId", "status");

-- CreateIndex
CREATE INDEX "contact_attempts_opportunityId_idx" ON "contact_attempts"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_contactAttemptId_key" ON "conversations"("contactAttemptId");

-- CreateIndex
CREATE INDEX "conversations_status_respondedAt_idx" ON "conversations"("status", "respondedAt");

-- CreateIndex
CREATE INDEX "conversations_prospectId_idx" ON "conversations"("prospectId");

-- CreateIndex
CREATE UNIQUE INDEX "domain_events_uniqueKey_key" ON "domain_events"("uniqueKey");

-- CreateIndex
CREATE INDEX "domain_events_status_occurredAt_idx" ON "domain_events"("status", "occurredAt");

-- CreateIndex
CREATE INDEX "domain_events_aggregateType_aggregateId_idx" ON "domain_events"("aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_createdAt_idx" ON "audit_logs"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signals" ADD CONSTRAINT "signals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "signals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_attempts" ADD CONSTRAINT "contact_attempts_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "prospects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_attempts" ADD CONSTRAINT "contact_attempts_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_attempts" ADD CONSTRAINT "contact_attempts_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "prospects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contactAttemptId_fkey" FOREIGN KEY ("contactAttemptId") REFERENCES "contact_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
