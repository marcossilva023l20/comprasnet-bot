import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ComprasNet Bot — Preenchedor de Propostas",
  description: "Sistema para preenchimento automático de propostas de licitação no ComprasNet",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-slate-50 text-slate-900 antialiased min-h-screen">{children}</body>
    </html>
  );
}
