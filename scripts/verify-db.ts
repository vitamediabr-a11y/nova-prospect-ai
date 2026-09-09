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
    "companies",
    "contact_attempts",
    "conversations",
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
       AND table_name IN ('companies', 'signals', 'opportunities')`,
  );
  const columnNames = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  for (const column of [
    "companies.websiteAnalysis",
    "companies.websiteAnalyzedAt",
    "signals.lastObservedAt",
    "signals.resolvedAt",
    "opportunities.dedupeKey",
  ]) {
    assert.ok(columnNames.has(column), `Coluna de website intelligence ausente: ${column}`);
  }

  const indexes = await client.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
  );
  const indexNames = new Set(indexes.rows.map((row) => row.indexname));
  for (const index of [
    "companies_dedupeKey_key",
    "contact_attempts_idempotencyKey_key",
    "conversations_contactAttemptId_key",
    "domain_events_uniqueKey_key",
    "opportunities_dedupeKey_key",
  ]) {
    assert.ok(indexNames.has(index), `Índice único crítico ausente: ${index}`);
  }

  await client.query("BEGIN");
  try {
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
       VALUES ('dbverify-opportunity-1', 'dbverify-company-1', 'dbverify:opportunity', 'Problema', '{}'::jsonb, 'Impacto', 'Solução', 10, '{}'::jsonb, 'LOW', NOW())`,
    );
    await expectUniqueViolation(
      () => client.query(
        `INSERT INTO "opportunities" ("id", "companyId", "dedupeKey", "problem", "evidence", "businessImpact", "recommendedSolution", "score", "scoreBreakdown", "priority", "updatedAt")
         VALUES ('dbverify-opportunity-2', 'dbverify-company-1', 'dbverify:opportunity', 'Outro', '{}'::jsonb, 'Impacto', 'Solução', 10, '{}'::jsonb, 'LOW', NOW())`,
      ),
      "idempotência de oportunidade",
    );

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

  console.log("Database verification passed: migrations, tables and critical uniqueness constraints are operational.");
} finally {
  await client.end();
}
