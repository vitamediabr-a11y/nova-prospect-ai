import Link from "next/link";
import { requireSession } from "@/lib/access";
import { SignOutButton } from "@/components/sign-out-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Nova Prospect<small>Nova Web Studios</small></div>
        <nav className="nav" aria-label="Navegação principal">
          <Link href="/painel">Painel</Link>
          <Link href="/descoberta">Descoberta</Link>
          <Link href="/inbox">Inbox</Link>
          <Link href="/empresas">Empresas</Link>
          <Link href="/empresas/nova">Cadastrar</Link>
        </nav>
        <div className="sidebar-footer">
          <div>{session.user.name}</div>
          <SignOutButton />
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
