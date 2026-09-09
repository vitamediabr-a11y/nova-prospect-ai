"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="form-stack"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        const form = new FormData(event.currentTarget);
        const result = await authClient.signIn.email({
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
          rememberMe: true,
        });
        setPending(false);
        if (result.error) {
          setError("E-mail ou senha inválidos.");
          return;
        }
        router.replace("/painel");
        router.refresh();
      }}
    >
      <div className="field">
        <label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="field">
        <label htmlFor="password">Senha</label>
        <input id="password" name="password" type="password" autoComplete="current-password" minLength={12} required />
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button primary" type="submit" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
    </form>
  );
}
