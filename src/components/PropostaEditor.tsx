"use client";

import { useState, useRef, useCallback } from "react";
import { parseLocalizedNumber } from "@/lib/numbers";

interface Item {
  id: number;
  propostaId: number;
  numeroItem: number;
  descricao: string;
  descricaoDetalhada: string | null;
  quantidade: string;
  unidade: string;
  valorEstimado: string | null;
  valorUnitario: string | null;
  marcaFabricante: string | null;
  modeloVersao: string | null;
  enviado: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PropostaEditorProps {
  propostaId: number;
  initialItens: Item[];
}

export default function PropostaEditor({ propostaId, initialItens }: PropostaEditorProps) {
  const [items, setItems] = useState<Item[]>(initialItens);
  const [expandedItem, setExpandedItem] = useState<number | null>(
    initialItens.length === 1 ? initialItens[0].id : null
  );
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [importLoading, setImportLoading] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [filter, setFilter] = useState<"all" | "filled" | "empty">("all");
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newItem, setNewItem] = useState({
    numeroItem: "", descricao: "", descricaoDetalhada: "",
    quantidade: "1", unidade: "Unidade",
    valorEstimado: "", valorUnitario: "", marcaFabricante: "", modeloVersao: "",
  });

  const showToast = (type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  };

  const handleSave = useCallback(async (itemId: number, data: Record<string, unknown>) => {
    setSaving((p) => ({ ...p, [itemId]: true }));
    try {
      const res = await fetch(`/api/propostas/${propostaId}/itens/${itemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const updated = await res.json();
        setItems((p) => p.map((i) => (i.id === itemId ? updated : i)));
        showToast("success", "Item salvo! ✓");
      } else showToast("error", "Erro ao salvar");
    } catch { showToast("error", "Erro de conexão"); }
    finally { setSaving((p) => ({ ...p, [itemId]: false })); }
  }, [propostaId]);

  const handleDelete = async (itemId: number) => {
    if (!confirm("Excluir este item?")) return;
    await fetch(`/api/propostas/${propostaId}/itens/${itemId}`, { method: "DELETE" });
    setItems((p) => p.filter((i) => i.id !== itemId));
    showToast("success", "Item excluído");
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`/api/propostas/${propostaId}/itens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...newItem,
        numeroItem: parseInt(newItem.numeroItem, 10) || items.length + 1,
        quantidade: newItem.quantidade,
      }),
    });
    if (res.ok) {
      const [novo] = await res.json();
      setItems((p) => [...p, novo].sort((a, b) => a.numeroItem - b.numeroItem));
      setShowAddItem(false);
      setNewItem({ numeroItem: "", descricao: "", descricaoDetalhada: "", quantidade: "1", unidade: "Unidade", valorEstimado: "", valorUnitario: "", marcaFabricante: "", modeloVersao: "" });
      showToast("success", "Item adicionado!");
      setExpandedItem(novo.id);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/propostas/${propostaId}/importar`, { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok) {
        showToast("success", data.message);
        const r2 = await fetch(`/api/propostas/${propostaId}/itens`);
        if (r2.ok) setItems(await r2.json());
      } else showToast("error", data.error || "Erro ao importar");
    } catch { showToast("error", "Erro ao importar arquivo"); }
    finally {
      setImportLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const fmt = (v: string | null) => v ? parseFloat(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

  const filteredItems = items.filter((i) => {
    const ok = filter === "all" ? true : filter === "filled" ? !!(i.valorUnitario && i.marcaFabricante) : !(i.valorUnitario && i.marcaFabricante);
    const s = search.toLowerCase();
    const match = !s || i.descricao.toLowerCase().includes(s) || String(i.numeroItem).includes(s);
    return ok && match;
  });

  const totalPreenchidos = items.filter((i) => i.valorUnitario && i.marcaFabricante).length;
  const pct = items.length > 0 ? Math.round((totalPreenchidos / items.length) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-xl shadow-lg text-white text-sm font-semibold flex items-center gap-2 ${toast.type === "success" ? "bg-green-600" : "bg-red-600"}`}>
          {toast.type === "success" ? "✓" : "✗"} {toast.text}
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Progress */}
          <div className="flex items-center gap-3">
            <div className="text-sm">
              <span className="font-bold text-slate-700">{totalPreenchidos}</span>
              <span className="text-slate-400">/{items.length} preenchidos</span>
            </div>
            <div className="w-28 bg-slate-100 rounded-full h-2.5">
              <div className={`h-2.5 rounded-full transition-all ${pct === 100 ? "bg-green-500" : "bg-[#1351b4]"}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs font-bold text-slate-500">{pct}%</span>
          </div>

          {/* Filter */}
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {(["all", "filled", "empty"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${filter === f ? "bg-white shadow text-[#1351b4]" : "text-slate-500 hover:text-slate-700"}`}>
                {f === "all" ? "Todos" : f === "filled" ? "✓ Prontos" : "✗ Pendentes"}
              </button>
            ))}
          </div>

          {/* Search */}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Buscar item..."
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 w-40"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input type="file" ref={fileInputRef} onChange={handleImport} accept=".xlsx,.xls,.csv" className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importLoading}
            className="bg-[#168821] hover:bg-[#0e5716] text-white px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50"
          >
            {importLoading ? "⏳" : "📥"} {importLoading ? "Importando..." : "Importar Planilha"}
          </button>
          <button
            onClick={() => setShowAddItem(true)}
            className="bg-[#1351b4] hover:bg-[#0c326f] text-white px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
          >
            + Adicionar Item
          </button>
          <button
            onClick={() => setBulkMode(!bulkMode)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition border ${bulkMode ? "bg-purple-100 text-purple-700 border-purple-300" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}
          >
            {bulkMode ? "📋 Tabela ✓" : "📋 Modo Tabela"}
          </button>
        </div>
      </div>

      {/* Add Item Modal */}
      {showAddItem && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-slate-800">Adicionar Novo Item</h2>
              <button onClick={() => setShowAddItem(false)} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
            </div>
            <form onSubmit={handleAddItem} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Nº Item</label>
                  <input type="number" value={newItem.numeroItem} onChange={(e) => setNewItem({ ...newItem, numeroItem: e.target.value })} placeholder={String(items.length + 1)} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Unidade</label>
                  <input type="text" value={newItem.unidade} onChange={(e) => setNewItem({ ...newItem, unidade: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Descrição *</label>
                <input type="text" value={newItem.descricao} onChange={(e) => setNewItem({ ...newItem, descricao: e.target.value })} required className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Descrição Detalhada</label>
                <textarea value={newItem.descricaoDetalhada} onChange={(e) => setNewItem({ ...newItem, descricaoDetalhada: e.target.value })} rows={2} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 resize-none" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Quantidade</label>
                  <input type="text" value={newItem.quantidade} onChange={(e) => setNewItem({ ...newItem, quantidade: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Val. Estimado (R$)</label>
                  <input type="text" value={newItem.valorEstimado} onChange={(e) => setNewItem({ ...newItem, valorEstimado: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Val. Unitário (R$)</label>
                  <input type="text" value={newItem.valorUnitario} onChange={(e) => setNewItem({ ...newItem, valorUnitario: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Marca/Fabricante</label>
                  <input type="text" value={newItem.marcaFabricante} onChange={(e) => setNewItem({ ...newItem, marcaFabricante: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Modelo/Versão</label>
                  <input type="text" value={newItem.modeloVersao} onChange={(e) => setNewItem({ ...newItem, modeloVersao: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50" />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => setShowAddItem(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-xl transition">Cancelar</button>
                <button type="submit" className="bg-[#1351b4] hover:bg-[#0c326f] text-white px-6 py-2 rounded-xl text-sm font-bold transition">Adicionar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Mode */}
      {bulkMode && items.length > 0 && (
        <BulkTable items={items} propostaId={propostaId} onUpdate={setItems} onToast={showToast} />
      )}

      {/* Items List */}
      {!bulkMode && (
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-bold text-slate-700 flex items-center gap-2">
              📦 Itens
              <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{filteredItems.length}</span>
            </h2>
          </div>

          {filteredItems.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
              {items.length === 0 ? (
                <>
                  <div className="text-5xl mb-3">📭</div>
                  <p className="font-bold text-slate-700 mb-1">Nenhum item ainda</p>
                  <p className="text-slate-500 text-sm mb-5">Importe uma planilha ou adicione itens manualmente</p>
                  <div className="flex gap-3 justify-center">
                    <button onClick={() => fileInputRef.current?.click()} className="bg-[#168821] text-white px-5 py-2 rounded-xl text-sm font-bold transition hover:bg-[#0e5716]">📥 Importar Planilha</button>
                    <button onClick={() => setShowAddItem(true)} className="bg-[#1351b4] text-white px-5 py-2 rounded-xl text-sm font-bold transition hover:bg-[#0c326f]">+ Adicionar Item</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-3xl mb-2">🔍</div>
                  <p className="text-slate-500">Nenhum item encontrado com os filtros atuais.</p>
                </>
              )}
            </div>
          ) : (
            filteredItems.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                isExpanded={expandedItem === item.id}
                onToggle={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
                onSave={handleSave}
                onDelete={handleDelete}
                isSaving={!!saving[item.id]}
                fmt={fmt}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Item Card (ComprasNet style) ─────────────────────────────────────────────
function ItemCard({ item, isExpanded, onToggle, onSave, onDelete, isSaving, fmt }: {
  item: Item;
  isExpanded: boolean;
  onToggle: () => void;
  onSave: (id: number, data: Record<string, unknown>) => void;
  onDelete: (id: number) => void;
  isSaving: boolean;
  fmt: (v: string | null) => string;
}) {
  const [vals, setVals] = useState({
    valorUnitario: item.valorUnitario || "",
    marcaFabricante: item.marcaFabricante || "",
    modeloVersao: item.modeloVersao || "",
  });

  const isFilled = !!(item.valorUnitario && item.marcaFabricante);
  const valorUnitarioNumerico = parseLocalizedNumber(vals.valorUnitario);
  const valorTotal = valorUnitarioNumerico && item.quantidade
    ? Number(valorUnitarioNumerico) * Number(item.quantidade)
    : 0;

  return (
    <div className={`bg-white rounded-2xl border-2 transition-all shadow-sm hover:shadow-md ${isFilled ? "border-green-200" : "border-slate-200"}`}>
      {/* Header */}
      <div className="px-5 py-4 cursor-pointer flex items-center gap-3" onClick={onToggle}>
        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${isFilled ? "bg-green-500 text-white" : "bg-[#1351b4] text-white"}`}>
          {item.numeroItem}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-800 text-sm uppercase truncate">{item.descricao}</p>
          {item.descricaoDetalhada && <p className="text-xs text-slate-400 truncate">{item.descricaoDetalhada}</p>}
          <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500 flex-wrap">
            <span>Qtd: <strong>{parseFloat(item.quantidade)}</strong> {item.unidade}</span>
            {item.valorEstimado && <span>Est: <strong>{fmt(item.valorEstimado)}</strong></span>}
            {isFilled && <span className="text-green-600 font-semibold">R$ {parseFloat(item.valorUnitario!).toFixed(2)} · {item.marcaFabricante}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${isFilled ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
            {isFilled ? "✓ Cadastrada" : "Não cadastrada"}
          </span>
          <svg className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Expanded Form */}
      {isExpanded && (
        <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Quantidade ofertada</label>
              <div className="bg-slate-100 rounded-xl px-3 py-2.5 text-sm text-slate-600">{parseFloat(item.quantidade)} {item.unidade}</div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Valor unitário (R$) *</label>
              <input
                type="text"
                value={vals.valorUnitario}
                onChange={(e) => setVals({ ...vals, valorUnitario: e.target.value })}
                placeholder="0,00"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Valor total</label>
              <div className="bg-slate-100 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700">
                {valorTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Marca/Fabricante *</label>
              <input
                type="text"
                value={vals.marcaFabricante}
                onChange={(e) => setVals({ ...vals, marcaFabricante: e.target.value })}
                placeholder="Ex: LORENZETTI"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Modelo/Versão</label>
              <input
                type="text"
                value={vals.modeloVersao}
                onChange={(e) => setVals({ ...vals, modeloVersao: e.target.value })}
                placeholder="Ex: ADVANCED TURBO"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <button onClick={() => onDelete(item.id)} className="text-red-500 hover:bg-red-50 px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1">
              🗑 Excluir
            </button>
            <button
              onClick={() => onSave(item.id, { valorUnitario: vals.valorUnitario || null, marcaFabricante: vals.marcaFabricante || null, modeloVersao: vals.modeloVersao || null })}
              disabled={isSaving}
              className="bg-[#1351b4] hover:bg-[#0c326f] text-white px-8 py-2.5 rounded-xl text-sm font-bold transition disabled:opacity-50 flex items-center gap-2"
            >
              {isSaving ? <><span className="animate-spin">⚙</span> Salvando...</> : "💾 Salvar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Bulk Edit Table ──────────────────────────────────────────────────────────
function BulkTable({ items, propostaId, onUpdate, onToast }: {
  items: Item[];
  propostaId: number;
  onUpdate: (items: Item[]) => void;
  onToast: (t: "success" | "error", msg: string) => void;
}) {
  const [rows, setRows] = useState(items.map((i) => ({
    id: i.id,
    valorUnitario: i.valorUnitario || "",
    marcaFabricante: i.marcaFabricante || "",
    modeloVersao: i.modeloVersao || "",
  })));
  const [saving, setSaving] = useState(false);

  const change = (idx: number, field: string, val: string) =>
    setRows((p) => p.map((r, i) => i === idx ? { ...r, [field]: val } : r));

  const saveAll = async () => {
    setSaving(true);
    try {
      const updated = [...items];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const res = await fetch(`/api/propostas/${propostaId}/itens/${row.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ valorUnitario: row.valorUnitario || null, marcaFabricante: row.marcaFabricante || null, modeloVersao: row.modeloVersao || null }),
        });
        if (res.ok) updated[i] = await res.json();
      }
      onUpdate(updated);
      onToast("success", `${rows.length} itens salvos!`);
    } catch { onToast("error", "Erro ao salvar"); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-white rounded-2xl border border-purple-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 bg-purple-50 border-b border-purple-100 flex items-center justify-between">
        <span className="font-bold text-purple-800 text-sm flex items-center gap-2">📋 Edição em Massa</span>
        <button onClick={saveAll} disabled={saving} className="bg-[#168821] hover:bg-[#0e5716] text-white px-5 py-2 rounded-xl text-xs font-bold transition disabled:opacity-50">
          {saving ? "⏳ Salvando..." : "💾 Salvar Todos"}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-3 py-2.5 text-left font-semibold text-slate-500 w-10">Nº</th>
              <th className="px-3 py-2.5 text-left font-semibold text-slate-500">Descrição</th>
              <th className="px-3 py-2.5 text-left font-semibold text-slate-500 w-20">Qtd</th>
              <th className="px-3 py-2.5 text-left font-semibold text-slate-500 w-28">Val. Estimado</th>
              <th className="px-3 py-2.5 text-left font-semibold text-slate-500 w-32">Valor Unitário *</th>
              <th className="px-3 py-2.5 text-left font-semibold text-slate-500 w-40">Marca/Fabricante *</th>
              <th className="px-3 py-2.5 text-left font-semibold text-slate-500 w-40">Modelo/Versão</th>
              <th className="px-3 py-2.5 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item, idx) => (
              <tr key={item.id} className="hover:bg-slate-50/50">
                <td className="px-3 py-2">
                  <span className="w-6 h-6 rounded-full bg-[#1351b4] text-white text-xs font-bold flex items-center justify-center">{item.numeroItem}</span>
                </td>
                <td className="px-3 py-2 font-medium text-slate-700 uppercase max-w-[160px] truncate">{item.descricao}</td>
                <td className="px-3 py-2 text-slate-500">{parseFloat(item.quantidade)}</td>
                <td className="px-3 py-2 text-slate-500 font-mono">
                  {item.valorEstimado ? parseFloat(item.valorEstimado).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                </td>
                <td className="px-3 py-2">
                  <input value={rows[idx]?.valorUnitario || ""} onChange={(e) => change(idx, "valorUnitario", e.target.value)} placeholder="0,00" className="w-full border border-slate-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-blue-500 outline-none bg-slate-50" />
                </td>
                <td className="px-3 py-2">
                  <input value={rows[idx]?.marcaFabricante || ""} onChange={(e) => change(idx, "marcaFabricante", e.target.value)} placeholder="Marca" className="w-full border border-slate-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-blue-500 outline-none bg-slate-50" />
                </td>
                <td className="px-3 py-2">
                  <input value={rows[idx]?.modeloVersao || ""} onChange={(e) => change(idx, "modeloVersao", e.target.value)} placeholder="Modelo" className="w-full border border-slate-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-blue-500 outline-none bg-slate-50" />
                </td>
                <td className="px-3 py-2 text-center text-base">
                  {rows[idx]?.valorUnitario && rows[idx]?.marcaFabricante ? "✅" : "⚠️"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
