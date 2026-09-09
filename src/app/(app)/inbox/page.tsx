import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { takeOverConversation } from "@/server/contacts/actions";

function relativeTime(date: Date) {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} d`;
}

export default async function InboxPage() {
  const conversations = await prisma.conversation.findMany({
    where: { status: "NEEDS_HUMAN" },
    orderBy: { respondedAt: "asc" },
    include: {
      prospect: {
        include: {
          company: true,
        },
      },
      contactAttempt: {
        include: {
          opportunity: true,
        },
      },
    },
    take: 100,
  });

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Inbox</p>
          <h1>Respostas registradas aguardando atendimento humano</h1>
          <p className="subtle">A fila reúne respostas registradas no sistema. O recebimento automático depende de uma integração de entrada configurada.</p>
        </div>
      </header>

      {conversations.length === 0 ? (
        <div className="empty">Nenhuma resposta registrada aguardando atendimento humano.</div>
      ) : (
        <div className="data-list">
          {conversations.map((conversation) => {
            const company = conversation.prospect.company;
            const opportunity = conversation.contactAttempt.opportunity;
            return (
              <article className="data-row" key={conversation.id}>
                <div>
                  <strong>{company.displayName}</strong>
                  <div className="subtle">{conversation.responsePreview ?? "Resposta registrada sem prévia."}</div>
                </div>
                <div>
                  <span>{conversation.contactAttempt.channel}</span>
                  <div className="subtle">{relativeTime(conversation.respondedAt)}</div>
                </div>
                <div>
                  <span className="score">{opportunity?.score ?? "—"}</span>
                  <div className="subtle">Score</div>
                </div>
                <div>
                  <Link href={`/empresas/${company.id}`}>Ver contexto</Link>
                  <form action={takeOverConversation}>
                    <input type="hidden" name="conversationId" value={conversation.id} />
                    <button type="submit">Assumir atendimento</button>
                  </form>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
