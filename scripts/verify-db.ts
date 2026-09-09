import "dotenv/config";
import assert from "node:assert/strict";
import { Client } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL não configurada para verificação do banco.");

const client = new Client({ connectionString });
let savepointCounter = 0;

async function expectUniqueViolation(run: () => Promise<unknown>, label: string) {
  const savepoint = `verify_unique_${++savepointCounter}`;
  await client.query(`SAVEPOINT ${savepoint}`);

  try {
    await run();
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    assert.fail(`${label}: a duplicação deveria ter sido bloqueada pelo banco.`);
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    if (error instanceof assert.AssertionError) throw error;
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    assert.equal(code, "23505", `${label}: esperado PostgreSQL unique_violation (23505), recebido ${code || "sem código"}.`);
  } finally {
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
}

await client.connect();

try {
  const tables = await client.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
  );
  const tableNames = new Set(tables.rows.map((row) => row.table_name));
  for (const table of [
    "_prisma_migrations",
    "account",
    "audit_logs",
    "commercial_analyses",
    "companies",
    "contact_attempts",
    "conversations",
    "discovery_runs",
    "domain_events",
    "icps",
    "opportunities",
    "prospects",
    "session",
    "signals",
    "user",
    "verification",
  ]) {
    assert.ok(tableNames.has(table), `Tabela ausente após migrate deploy: ${table}`);
  }

  const columns = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('companies', 'signals', 'opportunities', 'discovery_runs', 'commercial_analyses')`,
  );
  const columnNames = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  for (const column of [
    "companies.displayNameProvisional",
    "companies.websiteAnalysis",
    "companies.websiteAnalyzedAt",
    "signals.lastObservedAt",
    "signals.resolvedAt",
    "opportunities.dedupeKey",
    "opportunities.resolvedAt",
    "discovery_runs.provider",
    "discovery_runs.query",
    "discovery_runs.idempotencyKey",
    "discovery_runs.providerRequests",
    "commercial_analyses.companyId",
    "commercial_analyses.opportunityId",
    "commercial_analyses.inputFingerprint",
    "commercial_analyses.messageDraft",
    "commercial_analyses.evidenceReferences",
    "commercial_analyses.createdById",
  ]) {
    assert.ok(columnNames.has(column), `Coluna operacional ausente: ${column}`);
  }

  const sourceValues = await client.query<{ enumlabel: string }>(
    `SELECT enumlabel FROM pg_enum
     JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
     WHERE pg_type.typname = 'CompanySource'`,
  );
  assert.ok(sourceValues.rows.some((row) => row.enumlabel === "WEB_SEARCH"), "CompanySource.WEB_SEARCH ausente.");

  const indexes = await client.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
  );
  const indexNames = new Set(indexes.rows.map((row) => row.indexname));
  for (const index of [
    "companies_dedupeKey_key",
    "commercial_analyses_companyId_createdAt_idx",
    "commercial_analyses_createdById_createdAt_idx",
    "contact_attempts_idempotencyKey_key",
    "conversations_contactAttemptId_key",
    "discovery_runs_idempotencyKey_key",
    "domain_events_uniqueKey_key",
    "opportunities_dedupeKey_key",
    "opportunities_companyId_resolvedAt_idx",
  ]) {
    assert.ok(indexNames.has(index), `Índice crítico ausente: ${index}`);
  }

  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO "user" ("id", "name", "email", "updatedAt")
       VALUES ('dbverify-user-1', 'DB Verify User', 'dbverify@example.com', NOW())`,
    );
    await client.query(
      `INSERT INTO "companies" ("id", "displayName", "source", "dedupeKey", "updatedAt")
       VALUES ('dbverify-company-1', 'DB Verify', 'MANUAL', 'dbverify:company', NOW())`,
    );
    await expectUniqueViolation(
      () => client.query(
        `INSERT INTO "companies" ("id", "displayName", "source", "dedupeKey", "updatedAt")
         VALUES ('dbverify-company-2', 'DB Verify 2', 'MANUAL', 'dbverify:company', NOW())`,
      ),
      "dedupe de empresa",
    );

    await client.query(
      `INSERT INTO "discovery_runs" ("id", "provider", "segment", "location", "query", "requestedLimit", "createdById", "idempotencyKey")
       VALUES ('dbverify-run-1', 'BRAVE_SEARCH', 'clínica', 'Belém, PA', 'clínica Belém PA', 10, 'dbverify-user-1', 'dbverify:run')`,
    );
    await expectUniqueViolation(
      () => client.query(
        `INSERT INTO "discovery_runs" ("id", "provider", "segment", "location", "query", "requestedLimit", "createdById", "idempotencyKey")
         VALUES ('dbverify-run-2', 'BRAVE_SEARCH', 'clínica', 'Belém, PA', 'clínica Belém PA', 10, 'dbverify-user-1', 'dbverify:run')`,
      ),
      "idempotência de DiscoveryRun",
    );

    await client.query(
      `INSERT INTO "prospects" ("id", "companyId", "updatedAt")
       VALUES ('dbverify-prospect-1', 'dbverify-company-1', NOW())`,
    );
    await client.query(
      `INSERT INTO "contact_attempts" ("id", "prospectId", "channel", "messageDraft", "evidence", "idempotencyKey", "updatedAt")
       VALUES ('dbverify-contact-1', 'dbverify-prospect-1', 'EMAIL', 'Mensagem de verificação de banco.', '{}'::jsonb, 'dbverify:contact', NOW())`,
    );
    await expectUniqueViolation(
      () => client.query(
        `INSERT INTO "contact_attempts" ("id", "prospectId", "channel", "messageDraft", "evidence", "idempotencyKey", "updatedAt")
         VALUES ('dbverify-contact-2', 'dbverify-prospect-1', 'EMAIL', 'Outra mensagem de verificação.', '{}'::jsonb, 'dbverify:contact', NOW())`,
      ),
      "idempotência de abordagem",
    );

    await client.query(
      `INSERT INTO "conversations" ("id", "prospectId", "contactAttemptId", "responsePreview", "respondedAt", "updatedAt")
       VALUES ('dbverify-conversation-1', 'dbverify-prospect-1', 'dbverify-contact-1', 'Resposta', NOW(), NOW())`,
    );
    await expectUniqueViolation(
      () => client.query(
        `INSERT INTO "conversations" ("id", "prospectId", "contactAttemptId", "responsePreview", "respondedAt", "updatedAt")
         VALUES ('dbverify-conversation-2', 'dbverify-prospect-1', 'dbverify-contact-1', 'Resposta duplicada', NOW(), NOW())`,
      ),
      "conversa por primeira abordagem",
    );

    await client.query(
      `INSERT INTO "opportunities" ("id", "companyId", "dedupeKey", "problem", "evidence", "businessImpact", "recommendedSolution", "score", "scoreBreakdown", "priority", "updatedAt")
       VALUES ('dbverify-opportunity-1', 'dbverify-company-1', 'dbverify:opportunity', 'Landing page + lead qualification', '{}'::jsonb, 'Impacto', 'Qualificação antes do atendimento', 78, '{"explanation":"fixture determinística"}'::jsonb, 'HIGH', NOW())`,
    );
    await expectUniqueViolation(
      () => client.query(
        `INSERT INTO "opportunities" ("id", "companyId", "dedupeKey", "problem", "evidence", "businessImpact", "recommendedSolution", "score", "scoreBreakdown", "priority", "updatedAt")
         VALUES ('dbverify-opportunity-2', 'dbverify-company-1', 'dbverify:opportunity', 'Outro', '{}'::jsonb, 'Impacto', 'Solução', 10, '{}'::jsonb, 'LOW', NOW())`,
      ),
      "idempotência de oportunidade",
    );

    const activeBeforeResolve = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "opportunities" WHERE "id" = 'dbverify-opportunity-1' AND "resolvedAt" IS NULL`,
    );
    assert.equal(activeBeforeResolve.rows[0].count, "1", "Oportunidade nova deve começar ativa.");

    await client.query(
      `UPDATE "opportunities" SET "resolvedAt" = NOW(), "updatedAt" = NOW() WHERE "id" = 'dbverify-opportunity-1'`,
    );
    const activeAfterResolve = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "opportunities" WHERE "id" = 'dbverify-opportunity-1' AND "resolvedAt" IS NULL`,
    );
    assert.equal(activeAfterResolve.rows[0].count, "0", "Oportunidade resolvida não pode ser operacionalmente ativa.");

    await client.query(
      `UPDATE "opportunities" SET "resolvedAt" = NULL, "score" = 78, "updatedAt" = NOW() WHERE "dedupeKey" = 'dbverify:opportunity'`,
    );
    const reactivated = await client.query<{ id: string; score: number }>(
      `SELECT "id", "score" FROM "opportunities" WHERE "dedupeKey" = 'dbverify:opportunity' AND "resolvedAt" IS NULL`,
    );
    assert.equal(reactivated.rows.length, 1, "Reativação deve reutilizar a oportunidade existente.");
    assert.equal(reactivated.rows[0].id, "dbverify-opportunity-1", "Reativação não pode criar nova oportunidade.");
    assert.equal(reactivated.rows[0].score, 78, "Reativação deve aceitar score recalculado.");

    await client.query(
      `INSERT INTO "commercial_analyses" ("id", "companyId", "opportunityId", "provider", "model", "inputFingerprint", "summary", "commercialInterpretation", "messageDraft", "evidenceReferences", "confidence", "warnings", "status", "createdById")
       VALUES ('dbverify-ai-1', 'dbverify-company-1', 'dbverify-opportunity-1', 'FIXTURE', 'fixture-model', 'fixture-fingerprint', 'Resumo', 'Leitura comercial', 'Mensagem contextual de primeira abordagem com evidência suficiente.', '["opportunity:dbverify-opportunity-1"]'::jsonb, 'HIGH', '[]'::jsonb, 'SUCCESS', 'dbverify-user-1')`,
    );
    await client.query(
      `UPDATE "contact_attempts"
       SET "opportunityId" = 'dbverify-opportunity-1',
           "evidence" = '{"source":"AI_COMMERCIAL_ANALYSIS","commercialAnalysisId":"dbverify-ai-1"}'::jsonb,
           "updatedAt" = NOW()
       WHERE "id" = 'dbverify-contact-1'`,
    );
    const preparedDraft = await client.query<{ status: string; opportunityId: string | null }>(
      `SELECT "status", "opportunityId" FROM "contact_attempts" WHERE "id" = 'dbverify-contact-1'`,
    );
    assert.equal(preparedDraft.rows[0].status, "DRAFT", "Preparação por análise comercial deve permanecer DRAFT.");
    assert.equal(preparedDraft.rows[0].opportunityId, "dbverify-opportunity-1", "Rascunho deve reutilizar a oportunidade existente.");

    await client.query(
      `INSERT INTO "domain_events" ("id", "type", "aggregateType", "aggregateId", "payload", "uniqueKey")
       VALUES ('dbverify-event-1', 'dbverify.event', 'contact_attempt', 'dbverify-contact-1', '{}'::jsonb, 'dbverify:event')`,
    );
    await expectUniqueViolation(
      () => client.query(
        `INSERT INTO "domain_events" ("id", "type", "aggregateType", "aggregateId", "payload", "uniqueKey")
         VALUES ('dbverify-event-2', 'dbverify.event', 'contact_attempt', 'dbverify-contact-1', '{}'::jsonb, 'dbverify:event')`,
      ),
      "idempotência de evento",
    );
  } finally {
    await client.query("ROLLBACK");
  }

  console.log("Database verification passed: migrations, AI commercial analysis, DRAFT contact integration, discovery idempotency, lifecycle and critical uniqueness constraints are operational.");
} finally {
  await client.end();
}
