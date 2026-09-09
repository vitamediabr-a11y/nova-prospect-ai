import { CompanyCreateForm } from "@/components/company-create-form";

export default function NewCompanyPage() {
  return (
    <div className="page">
      <header className="page-header"><div><p className="eyebrow">Entrada manual</p><h1>Cadastrar empresa</h1><p className="subtle">Use dados verificáveis. Informações desconhecidas devem permanecer em branco.</p></div></header>
      <CompanyCreateForm />
    </div>
  );
}
