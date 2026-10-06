"use client";

import { useEffect, useState } from "react";

type Versao = {
  versao: string;
  descricao: string;
  experimental: boolean;
  zip: { url: string; nome: string };
};
type Catalogo = { recomendada: string; versoes: Versao[] };

export default function VersoesExtensao() {
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [selecionada, setSelecionada] = useState("");
  const [erro, setErro] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/extension-versions.json", { cache: "no-store", signal: controller.signal })
      .then(async (resp) => {
        if (!resp.ok) throw new Error("Não consegui carregar o catálogo de versões.");
        const dados: Catalogo = await resp.json();
        if (!Array.isArray(dados.versoes) || !dados.versoes.some((v) => v.versao === dados.recomendada)) throw new Error("Catálogo de versões inválido.");
        for (const v of dados.versoes) {
          if (!/^\d{1,4}(?:\.\d{1,4}){1,3}$/.test(v.versao) || v.zip?.url !== `/extension-releases/${v.versao}/extension.zip`) throw new Error("Pacote histórico inválido.");
        }
        if (!controller.signal.aborted) { setCatalogo(dados); setSelecionada(dados.recomendada); }
      })
      .catch((e: Error) => { if (!controller.signal.aborted) setErro(e.message); });
    return () => controller.abort();
  }, []);
  const versao = catalogo?.versoes.find((v) => v.versao === selecionada);
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4" aria-labelledby="titulo-versoes">
      <div>
        <h2 id="titulo-versoes" className="font-black text-slate-800 text-lg">🗂️ Escolher uma versão específica</h2>
        <p className="text-sm text-slate-500 mt-1">Você pode instalar uma atualização determinada ou voltar para uma anterior. Escolher aqui não altera sua extensão.</p>
      </div>
      {erro ? <p role="alert" className="text-sm text-red-700">{erro}</p> : (
        <>
          <label htmlFor="download-versao" className="block text-sm font-bold text-slate-700">Versão desejada</label>
          <select id="download-versao" className="w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-800" value={selecionada} onChange={(e) => setSelecionada(e.target.value)} disabled={!catalogo}>
            {!catalogo && <option value="">Carregando versões…</option>}
            {catalogo?.versoes.map((v) => <option key={v.versao} value={v.versao}>{v.versao}{v.versao === catalogo.recomendada ? " — recomendada/estável" : ""}{v.experimental ? " — EXPERIMENTAL" : ""}</option>)}
          </select>
          <p className="text-sm text-slate-600" aria-live="polite">{versao?.descricao}</p>
          {versao?.experimental && <p role="note" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Versão experimental: pode enviar lances reais. A operação no portal não foi validada. Não instale sem compreender os riscos.</p>}
          {versao && <a className="inline-flex rounded-lg bg-purple-700 px-5 py-3 font-bold text-white hover:bg-purple-800" href={versao.zip.url} download={versao.zip.nome}>⬇️ Baixar versão {versao.versao}</a>}
        </>
      )}
      <p className="text-xs text-slate-500">Pare os bots antes de trocar. Extraia o ZIP na pasta da extensão, recarregue em chrome://extensions e dê F5 no portal. Este catálogo permanece disponível mesmo se a versão escolhida tiver o atualizador antigo.</p>
    </section>
  );
}
