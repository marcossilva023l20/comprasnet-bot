import { db } from "@/db";
import { propostas, itens } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import PropostaEditor from "@/components/PropostaEditor";

export const dynamic = "force-dynamic";

export default async function PropostaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [proposta] = await db.select().from(propostas).where(eq(propostas.id, +id));
  if (!proposta) notFound();

  const itensList = await db.select().from(itens).where(eq(itens.propostaId, +id)).orderBy(asc(itens.numeroItem));
  const preenchidos = itensList.filter((i) => i.valorUnitario && i.marcaFabricante).length;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-[#1351b4] text-white shadow-lg shadow-blue-900/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <nav className="flex items-center gap-2 text-xs text-blue-200 mb-2">
            <Link href="/" className="hover:text-white transition">🏠 Início</Link>
            <span>›</span>
            <span>Cadastrar propostas</span>
          </nav>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-lg font-bold">
                Dispensa Eletrônica Nº {proposta.numeroDispensa}
              </h1>
              {proposta.uasg && <p className="text-blue-200 text-sm">{proposta.uasg}</p>}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Link href={`/api/propostas/${proposta.id}/exportar`} className="bg-white/15 hover:bg-white/25 text-white px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5">
                📤 Exportar Excel
              </Link>
              <Link href="/extensao" className="bg-white/15 hover:bg-white/25 text-white px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5">
                🧩 Usar Extensão
              </Link>
              <Link href="/" className="bg-white/15 hover:bg-white/25 text-white px-4 py-2 rounded-xl text-xs font-semibold transition">
                ← Voltar
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Info bar */}
      {(proposta.objeto || proposta.dataLimite) && (
        <div className="bg-white border-b border-slate-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-start gap-6 flex-wrap text-sm">
            {proposta.objeto && (
              <div>
                <span className="font-semibold text-[#1351b4]">Objeto: </span>
                <span className="text-slate-600">{proposta.objeto}</span>
              </div>
            )}
            {proposta.dataLimite && (
              <div className="text-slate-500">
                <span className="font-semibold">📅 Data limite: </span>{proposta.dataLimite}
              </div>
            )}
            <div className="ml-auto text-slate-500">
              <span className="font-semibold text-green-600">{preenchidos}</span>/{itensList.length} preenchidos
            </div>
          </div>
        </div>
      )}

      {/* Extension CTA */}
      {itensList.length > 0 && preenchidos > 0 && (
        <div className="bg-gradient-to-r from-purple-50 to-blue-50 border-b border-purple-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="text-xl">🧩</span>
              <div>
                <p className="text-sm font-bold text-purple-800">
                  {preenchidos} {preenchidos === 1 ? "item pronto" : "itens prontos"} para o ComprasNet!
                </p>
                <p className="text-xs text-purple-600">Use a extensão Chrome para preencher automaticamente no portal.</p>
              </div>
            </div>
            <Link href="/extensao" className="bg-purple-600 hover:bg-purple-700 text-white px-5 py-2 rounded-xl text-sm font-bold transition shadow-sm whitespace-nowrap">
              Ver instruções da extensão →
            </Link>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        <PropostaEditor propostaId={proposta.id} initialItens={itensList} />
      </main>
    </div>
  );
}
