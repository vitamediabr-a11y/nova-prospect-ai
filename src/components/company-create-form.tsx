"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { createCompany } from "@/server/companies/actions";
import {
  createCompanySchema,
  type CreateCompanyData,
  type CreateCompanyInput,
} from "@/server/companies/schema";

export function CompanyCreateForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { register, handleSubmit, formState: { errors } } = useForm<CreateCompanyInput, unknown, CreateCompanyData>({
    resolver: zodResolver(createCompanySchema),
    defaultValues: { displayName: "", website: "", instagram: "", whatsapp: "", email: "", location: "", industry: "" },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);
    startTransition(async () => {
      const result = await createCompany(values);
      if (!result.ok) {
        setServerError(result.message);
        return;
      }
      router.push(`/empresas/${result.id}`);
      router.refresh();
    });
  });

  return (
    <form className="form-stack" onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor="displayName">Empresa</label>
        <input id="displayName" autoFocus {...register("displayName")} />
        {errors.displayName && <p className="field-error">{errors.displayName.message}</p>}
      </div>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="website">Site</label>
          <input id="website" inputMode="url" placeholder="https://empresa.com.br" {...register("website")} />
          {errors.website && <p className="field-error">{errors.website.message}</p>}
        </div>
        <div className="field">
          <label htmlFor="instagram">Instagram</label>
          <input id="instagram" placeholder="@empresa" {...register("instagram")} />
        </div>
      </div>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="whatsapp">WhatsApp</label>
          <input id="whatsapp" inputMode="tel" placeholder="55 11 99999-9999" {...register("whatsapp")} />
        </div>
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" inputMode="email" {...register("email")} />
          {errors.email && <p className="field-error">{errors.email.message}</p>}
        </div>
      </div>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="industry">Segmento</label>
          <input id="industry" placeholder="Ex.: clínica odontológica" {...register("industry")} />
        </div>
        <div className="field">
          <label htmlFor="location">Localização</label>
          <input id="location" placeholder="Cidade, UF" {...register("location")} />
        </div>
      </div>
      {serverError && <p className="form-error" role="alert">{serverError}</p>}
      <div className="form-actions">
        <button className="button primary" type="submit" disabled={pending}>{pending ? "Salvando…" : "Cadastrar empresa"}</button>
      </div>
    </form>
  );
}
