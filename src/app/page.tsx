import Link from "next/link";
import { db } from "@/db";
import { propostas } from "@/db/schema";
import { desc, sql } from "drizzle-orm";
import { NovaPropostaButton, ExcluirPropostaButton } from "@/components/PropostaActions";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const rows = await db
    .select({
      id: propostas.id,
      numeroDispensa: propostas.numeroDispensa,
      uasg: propostas.uasg,
      objeto: propostas.objeto,
      dataLimite: propostas.dataLimite,
      status: propostas.status,
      createdAt: propostas.createdAt,
      totalItens: sql<number>`(SELECT COUNT(*) FROM itens WHERE itens.proposta_id = ${propostas.id})`,
      itensPreenchidos: sql<number>`(SELECT COUNT(*) FROM itens WHERE itens.proposta_id = ${propostas.id} AND itens.valor_unitario IS NOT NULL AND itens.marca_fabricante IS NOT NULL AND itens.marca_fabricante <> '')`,
      itensEnviados: sql<number>`(SELECT COUNT(*) FROM itens WHERE itens.proposta_id = ${propostas.id} AND itens.enviado = true)`,
    })
    .from(propostas)
    .orderBy(desc(propostas.createdAt));

  const total = rows.length;
  const completas = rows.filter(r => Number(r.totalItens) > 0 && Number(r.totalItens) === Number(r.itensPreenchidos)).length;
  const emAndamento = rows.filter(r => Number(r.itensPreenchidos) > 0 && Number(r.totalItens) !== Number(r.itensPreenchidos)).length;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="bg-[#1351b4] text-white shadow-lg shadow-blue-900/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-white/15 rounded-xl p-2.5">
              <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/>
                <path d="M8 12h8v2H8zm0 4h8v2H8zm0-8h3v2H8z"/>
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">ComprasNet Bot</h1>
              <p className="text-blue-200 text-xs">Preenchedor Automático de Propostas</p>
            </div>
          </div>
          <nav className="flex items-center gap-2 flex-wrap justify-end">
            <Link href="/extensao" className="bg-white/15 hover:bg-white/25 text-white px-3 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-1.5">
              🧩 Extensão Chrome
            </Link>
            <Link href="/deploy" className="bg-white/15 hover:bg-white/25 text-white px-3 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-1.5">
              🚀 Como Hospedar
            </Link>
            <Link href="/api/template" className="bg-white/15 hover:bg-white/25 text-white px-3 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-1.5">
              📥 Modelo Excel
            </Link>
            <NovaPropostaButton />
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-8 space-y-8">
        {/* Hero banner */}
        <div className="bg-gradient-to-r from-[#1351b4] to-[#0c326f] rounded-2xl p-6 text-white flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <h2 className="text-xl font-bold mb-1">Como funciona?</h2>
            <p className="text-blue-200 text-sm max-w-xl">
              Importe sua planilha Excel → preencha valores, marcas e modelos →
              instale a extensão Chrome → abra o ComprasNet → clique <strong className="text-white">Executar Bot</strong>.
              A extensão preenche todos os itens automaticamente! 🚀
            </p>
          </div>
          <div className="flex gap-3 flex-shrink-0">
            <Link href="/extensao" className="bg-white text-[#1351b4] hover:bg-blue-50 font-bold px-5 py-2.5 rounded-xl text-sm transition shadow-lg whitespace-nowrap flex items-center gap-2">
              🧩 Baixar Extensão
            </Link>
            <Link href="/deploy" className="bg-white/20 hover:bg-white/30 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition whitespace-nowrap">
              📖 Ver Tutorial
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total de Propostas", value: total, color: "text-[#1351b4]", bg: "bg-blue-50", icon: "📋" },
            { label: "Completas", value: completas, color: "text-green-600", bg: "bg-green-50", icon: "✅" },
            { label: "Em Andamento", value: emAndamento, color: "text-amber-600", bg: "bg-amber-50", icon: "⏳" },
            { label: "Rascunhos", value: total - completas - emAndamento, color: "text-slate-600", bg: "bg-slate-50", icon: "📝" },
          ].map((s) => (
            <div key={s.label} className={`${s.bg} rounded-2xl p-5 border border-white shadow-sm`}>
              <div className="text-2xl mb-1">{s.icon}</div>
              <div className={`text-3xl font-black ${s.color}`}>{s.value}</div>
              <div className="text-xs text-slate-500 font-medium mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Proposals */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-slate-800">Suas Propostas</h2>
            <NovaPropostaButton />
          </div>

          {rows.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-16 text-center">
              <div className="text-6xl mb-4">📂</div>
              <h3 className="text-lg font-bold text-slate-700 mb-2">Nenhuma proposta ainda</h3>
              <p className="text-slate-500 text-sm mb-6 max-w-sm mx-auto">
                Crie sua primeira proposta e importe a planilha com os itens da licitação.
              </p>
              <NovaPropostaButton />
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((p) => {
                const total = Number(p.totalItens);
                const preenchidos = Number(p.itensPreenchidos);
                const enviados = Number(p.itensEnviados);
                const pct = total > 0 ? Math.round((preenchidos / total) * 100) : 0;
                const isComplete = total > 0 && preenchidos === total;

                return (
                  <div key={p.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow group">
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 flex-wrap mb-1">
                            <Link href={`/proposta/${p.id}`} className="font-bold text-[#1351b4] hover:underline text-base truncate">
                              Dispensa Eletrônica Nº {p.numeroDispensa}
                            </Link>
                            <span className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                              isComplete ? "bg-green-100 text-green-700" :
                              pct > 0 ? "bg-amber-100 text-amber-700" :
                              "bg-slate-100 text-slate-600"
                            }`}>
                              {isComplete ? "✅ Completa" : pct > 0 ? "⏳ Em andamento" : "📝 Rascunho"}
                            </span>
                          </div>
                          {p.uasg && <p className="text-xs text-slate-500 mb-1">🏛️ {p.uasg}</p>}
                          {p.objeto && <p className="text-xs text-slate-500 line-clamp-1 mb-2">📌 {p.objeto}</p>}
                          <div className="flex items-center gap-4 text-xs text-slate-400 flex-wrap">
                            {p.dataLimite && <span>📅 Prazo: {p.dataLimite}</span>}
                            <span>📦 {total} itens</span>
                            <span className="text-green-600 font-medium">✓ {preenchidos} preenchidos</span>
                            {enviados > 0 && <span className="text-blue-600 font-medium">🚀 {enviados} enviados</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Link href={`/proposta/${p.id}`} className="bg-[#1351b4] hover:bg-[#0c326f] text-white px-4 py-2 rounded-xl text-sm font-semibold transition whitespace-nowrap">
                            Editar
                          </Link>
                          <Link href={`/api/propostas/${p.id}/exportar`} className="border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-2 rounded-xl text-sm transition" title="Exportar Excel">
                            📤
                          </Link>
                          <ExcluirPropostaButton id={p.id} />
                        </div>
                      </div>

                      {total > 0 && (
                        <div className="mt-4">
                          <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                            <span>Progresso de preenchimento</span>
                            <span className="font-semibold">{pct}%</span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${isComplete ? "bg-green-500" : "bg-[#1351b4]"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-slate-200 py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 text-center text-xs text-slate-400">
          ComprasNet Bot · Sistema de Preenchimento Automático de Propostas · Compatível com Vercel + Neon + GitHub
        </div>
      </footer>
    </div>
  );
}
