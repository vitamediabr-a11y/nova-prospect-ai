# Nova Prospect AI

Plataforma interna de inteligência comercial e prospecção da Nova Web Studios.

## Fluxo central

`Company → Signal → Opportunity → Score → First Message → Response → Human Handoff`

## Estado atual

Fundação inicial implementada com Next.js 16, TypeScript, PostgreSQL/Neon, Prisma 7 e Better Auth. O sistema parte de dados reais: nenhum dashboard é preenchido com métricas fictícias e integrações não configuradas não são simuladas.

Já existem:

- autenticação interna com cadastro público desativado;
- RBAC server-side (`OWNER`, `ADMIN`, `MANAGER`, `SALES`, `VIEWER`);
- entidades Company, ICP, Prospect, Signal, Opportunity, ContactAttempt, Conversation, DomainEvent e AuditLog;
- deduplicação de empresas na entrada manual;
- score determinístico e explicável;
- regra de supressão `NÃO CONTATAR` acima do score;
- regras determinísticas iniciais de oportunidade;
- painel operacional baseado no banco real;
- cadastro manual de empresas;
- CI com testes, lint, typecheck e build.

## Configuração

Copie `.env.example` para `.env` e configure `DATABASE_URL`, `BETTER_AUTH_SECRET` e `BETTER_AUTH_URL`.

Depois de aplicar as migrations, o primeiro usuário interno pode ser criado com `OWNER_EMAIL` e `OWNER_PASSWORD` usando `npm run db:bootstrap-owner`. O cadastro público permanece bloqueado no runtime normal.
