import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect("/painel");

  return (
    <main className="login-wrap">
      <section className="login">
        <p className="eyebrow">Nova Web Studios</p>
        <h1>Nova Prospect AI</h1>
        <p className="subtle">Acesso interno. Entre com sua conta autorizada.</p>
        <LoginForm />
        <p className="login-note">O cadastro público está desativado.</p>
      </section>
    </main>
  );
}
