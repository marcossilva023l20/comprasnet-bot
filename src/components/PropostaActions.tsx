"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NovaPropostaButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const [form, setForm] = useState({ numeroDispensa: "", uasg: "", objeto: "", dataLimite: "" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.numeroDispensa.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/propostas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const data = await res.json();
        setOpen(false);
        setForm({ numeroDispensa: "", uasg: "", objeto: "", dataLimite: "" });
        router.push(`/proposta/${data.id}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="bg-[#168821] hover:bg-[#0e5716] text-white px-4 py-2 rounded-xl text-sm font-bold transition flex items-center gap-2 shadow-sm"
      >
        + Nova Proposta
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full">
            <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-800">Nova Proposta</h2>
                <p className="text-xs text-slate-500">Preencha os dados da licitação</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Número da Dispensa *</label>
                <input
                  type="text"
                  value={form.numeroDispensa}
                  onChange={(e) => setForm({ ...form, numeroDispensa: e.target.value })}
                  placeholder="Ex: 51/2026"
                  required
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">UASG</label>
                <input
                  type="text"
                  value={form.uasg}
                  onChange={(e) => setForm({ ...form, uasg: e.target.value })}
                  placeholder="Ex: UASG 380195 - ESP-PENIT.AEVP JAIR GUIMAR"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Objeto</label>
                <textarea
                  value={form.objeto}
                  onChange={(e) => setForm({ ...form, objeto: e.target.value })}
                  placeholder="Descrição do objeto da licitação"
                  rows={2}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-slate-50 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Data Limite</label>
                <input
                  type="text"
                  value={form.dataLimite}
                  onChange={(e) => setForm({ ...form, dataLimite: e.target.value })}
                  placeholder="Ex: 02/10/2026 07:59"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-slate-50"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-xl transition">Cancelar</button>
                <button type="submit" disabled={loading} className="bg-[#1351b4] hover:bg-[#0c326f] text-white px-6 py-2 rounded-xl text-sm font-bold transition disabled:opacity-50">
                  {loading ? "Criando..." : "Criar Proposta"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export function ExcluirPropostaButton({ id }: { id: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!confirm("Excluir esta proposta e todos os seus itens?")) return;
    setLoading(true);
    try {
      await fetch(`/api/propostas/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <button onClick={handle} disabled={loading} title="Excluir" className="border border-slate-200 hover:bg-red-50 hover:border-red-200 text-slate-400 hover:text-red-500 p-2 rounded-xl transition disabled:opacity-50">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    </button>
  );
}
