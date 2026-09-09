import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nova Prospect AI",
  description: "Inteligência comercial e prospecção da Nova Web Studios",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
