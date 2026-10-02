/**
 * ComprasNet Bot — Popup Script
 */

// ─── State ────────────────────────────────────────────────────────────────────
let apiUrl = "";
let allItems = [];
let selectedIds = new Set();
let running = false;
let currentTab = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const cfg = await chrome.storage.local.get(["apiUrl"]);
  apiUrl = cfg.apiUrl || "";
  document.getElementById("api-url").value = apiUrl;

  bindEvents();
  await getCurrentTab();
  checkPage();
  loadPropostas();
  iniciarAtualizacoes();
});

/**
 * Manifest V3 bloqueia handlers inline (onclick="..."): a CSP da extensao
 * so permite script-src 'self'. Entao todos os eventos sao ligados aqui.
 */
/**
 * O content script avisa cada item; o popup (ou a janela flutuante) mostra.
 * Funciona mesmo com a janela do popup fechada — o painel na página continua.
 */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.action !== "progresso") return;
  if (msg.status === "preenchendo") {
    setProgress((msg.indice || 1) - 1, msg.total || 1);
    addLog("info", `🤖 Item ${msg.item}: preenchendo (${msg.indice}/${msg.total})...`);
    const botao = document.getElementById("pause-btn");
    if (botao && botao.textContent.includes("Pausar")) botao.textContent = "⏸ Pausar";
  } else if (msg.status === "fim") {
    addLog("info", `🏁 Fim: ${msg.filled}/${msg.total} preenchidos · ${msg.confirmados} confirmados.`);
  }
});

function bindEvents() {
  document.querySelectorAll('[data-action="tab"]').forEach((el) => {
    el.addEventListener("click", () => showTab(el.dataset.tab));
  });

  const on = (id, evt, fn) => document.getElementById(id)?.addEventListener(evt, fn);

  on("btn-check-page", "click", checkPage);
  on("btn-read-page", "click", () => readPage());
  on("proposta-select", "change", loadItems);
  on("btn-select-all", "click", selectAll);
  on("btn-select-filled", "click", selectFilled);
  on("btn-clear-sel", "click", clearSel);
  on("run-btn", "click", runBot);
  on("stop-btn", "click", stopBot);
  on("pause-btn", "click", alternarPausa);
  on("pin-btn", "click", fixarPainelNaPagina);
  on("float-btn", "click", abrirJanelaFlutuante);
  on("copy-log-btn", "click", copiarRelatorio);
  on("btn-read-items", "click", readItemsFromPage);
  on("btn-send-items", "click", sendItemsToApp);
  on("import-confirmar", "change", updateEnvioState);
  on("btn-save-config", "click", saveConfig);
  on("btn-check-update", "click", () => verificarAtualizacao({ silencioso: false }));
  on("btn-auto-update", "click", abrirAtualizador);
  on("btn-download-update", "click", () => {
    if (!apiUrl) { alert("Configure a URL do sistema primeiro!"); return; }
    chrome.tabs.create({ url: `${apiUrl}/extension.zip` });
  });
  on("btn-reload-extension", "click", () => chrome.runtime.reload());
  on("update-notice", "click", abrirAtualizador);
  on("btn-open-app", "click", openApp);
  on("btn-open-comprasnet", "click", openComprasNet);
  on("api-url", "keydown", (e) => {
    if (e.key === "Enter") saveConfig();
  });
}

async function getCurrentTab() {
  // Na janela flutuante não existe aba ativa do ComprasNet: usa a que o popup
  // original guardou antes de abrir a janela.
  const emJanela = new URLSearchParams(location.search).has("janela");
  if (emJanela) {
    try {
      const salvo = await chrome.storage.session.get("janelaTabId");
      const id = salvo?.janelaTabId;
      if (id) currentTab = await chrome.tabs.get(id).catch(() => null);
    } catch (_) {
      currentTab = null;
    }
  }

  if (!currentTab) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
  }

  if (currentTab?.url) {
    const el = document.getElementById("page-url");
    if (el) el.textContent = currentTab.url;
  }
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function showTab(name) {
  ["bot", "config", "ajuda"].forEach((t) => {
    document.getElementById(`panel-${t}`)?.classList.toggle("hidden", t !== name);
    document.getElementById(`tab-${t}`)?.classList.toggle("active", t === name);
  });
}

// ─── Page Status / Leitura ────────────────────────────────────────────────────
async function checkPage() {
  if (!currentTab?.id) {
    setStatus("idle", "Sem aba ativa");
    return;
  }

  if (!isComprasNetPage(currentTab.url || "")) {
    setStatus("warn", "Abra o ComprasNet");
    return;
  }

  try {
    const resp = await chrome.tabs.sendMessage(currentTab.id, { action: "ping" });
    if (resp?.ok) {
      setStatus("ok", "ComprasNet detectado ✓");
    } else {
      setStatus("warn", "Página carregando...");
    }
  } catch (_) {
    setStatus("warn", "Recarregue a página");
  }
}

function isComprasNetPage(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return (
      host === "comprasnet.gov.br" ||
      host === "www.comprasnet.gov.br" ||
      host.endsWith(".comprasnet.gov.br") ||
      host === "cnetmobile.estaleiro.serpro.gov.br" ||
      host === "compras.gov.br" ||
      host.endsWith(".compras.gov.br") ||
      (host === "www.gov.br" && url.pathname.startsWith("/compras"))
    );
  } catch (_) {
    return false;
  }
}

async function readPage({ quiet = false } = {}) {
  const button = document.getElementById("btn-read-page");
  if (!currentTab?.id) {
    setReadStatus("warning", "Não encontrei uma aba ativa para ler.");
    return null;
  }
  if (!isComprasNetPage(currentTab.url || "")) {
    setReadStatus("warning", "Abra primeiro a página de cadastro de propostas do ComprasNet.");
    return null;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "⏳ Lendo...";
  }
  setReadStatus("info", "Analisando os campos visíveis da página...");

  try {
    const result = await chrome.tabs.sendMessage(currentTab.id, { action: "scan_page" });
    if (!result?.ok) throw new Error(result?.error || "A página não respondeu à leitura.");
    showReadResult(result);
    return result;
  } catch {
    const message = "Não consegui ler esta página. Recarregue o ComprasNet e tente novamente.";
    setReadStatus("warning", message);
    if (!quiet) addLog("error", message);
    return null;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "📖 Ler página";
    }
  }
}

function showReadResult(result) {
  const labels = {
    valorUnitario: "valor",
    marcaFabricante: "marca",
    modeloVersao: "modelo",
  };

  if (!result.recognizedFields) {
    setReadStatus(
      "warning",
      "Não encontrei campos visíveis de valor, marca ou modelo. Expanda um item no ComprasNet e clique em “Ler página” novamente.",
    );
    return;
  }

  if (!result.itemCount) {
    const found = (result.unassignedFields || []).map((field) => labels[field] || field).join(", ");
    setReadStatus(
      "warning",
      `Encontrei ${result.recognizedFields} campo(s) (${found}), mas não consegui associá-los a um número de item. Para evitar preencher o item errado, expanda um item e faça a leitura novamente.`,
    );
    return;
  }

  const itemDetails = (result.items || []).slice(0, 3).map((item) => {
    const names = (item.fields || []).map((field) => labels[field] || field).join("/");
    return `Item ${item.item}: ${names || "sem campos"}`;
  });
  if (result.items?.length > itemDetails.length) itemDetails.push("…");

  const incomplete = (result.items || []).some((item) => !item.complete) || (result.unassignedFields || []).length > 0;
  const unassignedNote = (result.unassignedFields || []).length ? " Alguns campos não foram associados a um item." : "";
  const summary = `Página lida: ${result.itemCount} item(ns), ${result.recognizedFields} campo(s) mapeado(s). ${itemDetails.join(" · ")}${unassignedNote}`;
  setReadStatus(incomplete ? "warning" : "success", summary);
}

function setReadStatus(type, message) {
  const element = document.getElementById("page-read-status");
  if (!element) return;
  element.className = `alert alert-${type} mt-2`;
  element.textContent = message;
}

function setStatus(type, msg) {
  const badge = document.getElementById("page-status-badge");
  const text = document.getElementById("page-status-text");
  if (!badge || !text) return;
  badge.className = `status-badge status-${type}`;
  text.textContent = msg;
}

// ─── Importar itens da página (extensão → sistema) ────────────────────────────
//
// Fluxo: lê os itens publicados na página do ComprasNet, mostra o que foi lido,
// confere no sistema qual proposta corresponde à página e, com confirmação
// explícita, envia os itens (substituindo os itens atuais daquela proposta).

let itensLidos = null;
let destinoLido = null;
let identificacaoLida = null;

async function readItemsFromPage() {
  if (!currentTab?.id) {
    setImportStatus("warning", "Não encontrei uma aba ativa para ler.");
    return;
  }
  if (!isComprasNetPage(currentTab.url || "")) {
    setImportStatus("warning", "Abra primeiro a página de cadastro de propostas do ComprasNet.");
    return;
  }

  const expandir = document.getElementById("import-expandir")?.checked !== false;
  const button = document.getElementById("btn-read-items");
  if (button) {
    button.disabled = true;
    button.textContent = "⏳ Lendo itens...";
  }
  setImportStatus("info", expandir ? "Lendo e expandindo cada item da página..." : "Lendo os itens da página...");
  document.getElementById("import-preview")?.classList.add("hidden");
  document.getElementById("import-envio")?.classList.add("hidden");
  document.getElementById("import-destino")?.classList.add("hidden");
  itensLidos = null;
  destinoLido = null;
  identificacaoLida = null;

  try {
    const result = await chrome.tabs.sendMessage(currentTab.id, {
      action: "read_comprasnet_items",
      expandir,
      delay: 450,
    });

    if (!result?.ok) throw new Error(result?.error || "A página não respondeu à leitura.");
    if (!Array.isArray(result.itens) || result.itens.length === 0) {
      throw new Error("Não encontrei itens nesta página. Confira se a lista de itens está visível.");
    }

    itensLidos = result.itens;
    identificacaoLida = result.identificacao || {};
    renderImportPreview(result);
    await previewDestino(identificacaoLida);

    const avisos = result.avisos?.length ? ` ${result.avisos.join(" ")}` : "";
    setImportStatus(
      result.avisos?.length ? "warning" : "success",
      `Li ${result.itens.length} item(ns)${result.expandidos ? ` (${result.expandidos} expandido(s))` : ""}. Confira abaixo e confirme para enviar.${avisos}`,
    );
    document.getElementById("import-envio")?.classList.remove("hidden");
    updateEnvioState();
  } catch (e) {
    setImportStatus("warning", e.message || "Não consegui ler os itens desta página.");
    addLog("error", `Leitura de itens: ${e.message}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "📥 Ler itens da página";
    }
  }
}

function renderImportPreview(result) {
  const ident = result.identificacao || {};
  const resumo = document.getElementById("import-destino");
  if (resumo) {
    resumo.className = "text-xs mt-2";
    resumo.innerHTML = "";
    const linhas = [
      ident.uasg ? `UASG: ${ident.uasg}` : null,
      ident.numeroCompra ? `Compra/processo: ${ident.numeroCompra}` : null,
      ident.objeto ? `Objeto: ${ident.objeto}` : null,
      ident.dataLimite ? `Data limite: ${ident.dataLimite}` : null,
    ].filter(Boolean);

    const titulo = document.createElement("div");
    titulo.style.fontWeight = "700";
    titulo.textContent = "Página identificada";
    resumo.appendChild(titulo);
    linhas.forEach((linha) => {
      const div = document.createElement("div");
      div.textContent = linha;
      resumo.appendChild(div);
    });
  }

  const lista = document.getElementById("import-list");
  if (!lista) return;
  lista.innerHTML = "";

  result.itens.forEach((item) => {
    const row = document.createElement("div");
    row.className = "item-row";

    const num = document.createElement("div");
    num.className = "item-num";
    num.textContent = item.numeroItem;

    const desc = document.createElement("div");
    desc.className = "item-desc";
    desc.title = item.descricaoDetalhada || item.descricao || "";
    desc.textContent = item.descricao || "(sem descrição)";

    const val = document.createElement("div");
    val.className = "item-val";
    val.textContent = `${item.quantidade || "?"} ${item.unidade || ""}${item.valorEstimado ? ` · ${item.valorEstimado}` : ""}`;

    row.append(num, desc, val);
    lista.appendChild(row);
  });

  document.getElementById("import-preview")?.classList.remove("hidden");
}

async function previewDestino(identificacao) {
  if (!apiUrl) {
    setImportStatus("warning", "Configure a URL do sistema na aba ⚙️ Config antes de enviar.");
    return;
  }

  try {
    const params = new URLSearchParams();
    if (identificacao.uasg) params.set("uasg", identificacao.uasg);
    if (identificacao.numeroCompra) params.set("numeroCompra", identificacao.numeroCompra);

    const res = await fetch(`${apiUrl}/api/propostas/localizar?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    destinoLido = data;

    const bloco = document.getElementById("import-destino");
    const aviso = document.createElement("div");
    aviso.className = data.encontrada ? "alert alert-info mt-2" : "alert alert-success mt-2";
    aviso.textContent = data.encontrada
      ? `🎯 Proposta correspondente: nº ${data.proposta.numeroDispensa} (${data.proposta.totalItens} item(ns) hoje). Motivo: ${data.motivo}.`
      : `🆕 Nenhuma proposta corresponde a esta página: uma nova será criada ao enviar. (${data.motivo})`;
    bloco?.appendChild(aviso);
  } catch (e) {
    const bloco = document.getElementById("import-destino");
    const aviso = document.createElement("div");
    aviso.className = "alert alert-warning mt-2";
    aviso.textContent = `Não consegui consultar o sistema agora (${e.message}). Você ainda pode enviar; o sistema decide o destino no envio.`;
    bloco?.appendChild(aviso);
  }
}

function updateEnvioState() {
  const confirmado = document.getElementById("import-confirmar")?.checked === true;
  const pronto = Boolean(apiUrl) && Array.isArray(itensLidos) && itensLidos.length > 0 && confirmado;
  const botao = document.getElementById("btn-send-items");
  if (botao) botao.disabled = !pronto;
}

async function sendItemsToApp() {
  if (!Array.isArray(itensLidos) || itensLidos.length === 0) {
    setImportStatus("warning", "Leia os itens da página antes de enviar.");
    return;
  }
  if (!apiUrl) {
    setImportStatus("warning", "Configure a URL do sistema na aba ⚙️ Config.");
    return;
  }
  if (document.getElementById("import-confirmar")?.checked !== true) {
    setImportStatus("warning", "Marque a confirmação de substituição antes de enviar.");
    return;
  }

  const button = document.getElementById("btn-send-items");
  if (button) {
    button.disabled = true;
    button.textContent = "⏳ Enviando...";
  }
  setImportStatus("info", `Enviando ${itensLidos.length} item(ns) para o sistema...`);

  try {
    const res = await fetch(`${apiUrl}/api/propostas/importar-pagina`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identificacao: identificacaoLida || {},
        itens: itensLidos,
        confirmarSubstituicao: true,
      }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const detalhes = (data.itensIgnorados || []).map((i) => `item ${i.indice}: ${i.motivo}`).join("; ");
      throw new Error(`${data.error || `HTTP ${res.status}`}${detalhes ? ` (${detalhes})` : ""}`);
    }

    const avisos = data.avisos?.length ? ` ${data.avisos.join(" ")}` : "";
    setImportStatus(
      "success",
      `✅ ${data.itensInseridos} item(ns) gravados na proposta nº ${data.proposta?.numeroDispensa ?? data.proposta?.id}` +
        `${data.criada ? " (proposta criada agora)" : ` — ${data.itensSubstituidos} item(ns) anterior(es) substituído(s)`}.${avisos}`,
    );
    addLog("success", `Itens enviados: proposta ${data.proposta?.id} (${data.itensInseridos} itens).`);

    const abrir = document.getElementById("btn-open-proposta");
    if (abrir) abrir.remove();
    if (data.proposta?.id) {
      const link = document.createElement("button");
      link.className = "btn btn-outline mt-2";
      link.id = "btn-open-proposta";
      link.textContent = "📊 Abrir proposta no sistema";
      link.addEventListener("click", () => chrome.tabs.create({ url: `${apiUrl}/proposta/${data.proposta.id}` }));
      document.getElementById("import-envio")?.appendChild(link);
    }

    const confirmar = document.getElementById("import-confirmar");
    if (confirmar) confirmar.checked = false;
    await loadPropostas();
  } catch (e) {
    setImportStatus("warning", `Não foi possível enviar: ${e.message}`);
    addLog("error", `Envio de itens: ${e.message}`);
  } finally {
    if (button) button.textContent = "⬆️ Enviar para o sistema";
    updateEnvioState();
  }
}

function setImportStatus(type, message) {
  const element = document.getElementById("import-status");
  if (!element) return;
  element.className = `alert alert-${type} mt-2`;
  element.textContent = message;
}

// ─── Config ───────────────────────────────────────────────────────────────────
async function saveConfig() {
  apiUrl = document.getElementById("api-url").value.trim().replace(/\/$/, "");
  await chrome.storage.local.set({ apiUrl });
  addLog("success", "Configuração salva!");
  loadPropostas();
}

function openApp() {
  if (!apiUrl) { alert("Configure a URL do sistema primeiro!"); return; }
  chrome.tabs.create({ url: apiUrl });
}

function openComprasNet() {
  chrome.tabs.create({ url: "https://www.comprasnet.gov.br/seguro/loginPortalFornecedor.asp" });
}

// ─── Load Proposals ───────────────────────────────────────────────────────────
async function loadPropostas() {
  if (!apiUrl) {
    const sel = document.getElementById("proposta-select");
    sel.innerHTML = '<option value="">⚠️ Configure a URL do sistema na aba ⚙️</option>';
    return;
  }

  try {
    const res = await fetch(`${apiUrl}/api/propostas`);
    const data = await res.json();

    const sel = document.getElementById("proposta-select");
    if (!Array.isArray(data) || data.length === 0) {
      sel.innerHTML = '<option value="">Nenhuma proposta cadastrada</option>';
      return;
    }

    sel.innerHTML = '<option value="">-- Selecione a proposta --</option>';
    data.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `Nº ${p.numeroDispensa}${p.uasg ? " — " + p.uasg : ""}`;
      sel.appendChild(opt);
    });
  } catch (e) {
    addLog("error", "Erro ao carregar propostas: " + e.message);
  }
}

// ─── Load Items ───────────────────────────────────────────────────────────────
async function loadItems() {
  const propostaId = document.getElementById("proposta-select").value;
  if (!propostaId) {
    document.getElementById("stats-grid").style.display = "none";
    document.getElementById("items-card").style.display = "none";
    document.getElementById("run-card").style.display = "none";
    return;
  }

  try {
    const res = await fetch(`${apiUrl}/api/propostas/${propostaId}/itens`);
    allItems = await res.json();

    // Pre-select filled items
    selectedIds = new Set(
      allItems.filter((i) => i.valorUnitario && i.marcaFabricante).map((i) => i.id)
    );

    renderItems();
    updateStats();

    document.getElementById("stats-grid").style.display = "grid";
    document.getElementById("items-card").style.display = "block";
    document.getElementById("run-card").style.display = "block";
  } catch (e) {
    addLog("error", "Erro ao carregar itens: " + e.message);
  }
}

function renderItems() {
  const list = document.getElementById("items-list");
  list.innerHTML = "";

  allItems.forEach((item) => {
    const filled = !!(item.valorUnitario && item.marcaFabricante);
    const sel = selectedIds.has(item.id);

    const row = document.createElement("div");
    row.className = `item-row${filled ? " filled" : ""}`;
    row.id = `item-row-${item.id}`;
    row.style.cursor = "pointer";
    row.addEventListener("click", () => toggleItem(item.id));

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = sel;
    check.addEventListener("click", (e) => e.stopPropagation());
    check.addEventListener("change", () => toggleItem(item.id));

    const num = document.createElement("div");
    num.className = "item-num";
    num.textContent = item.numeroItem;

    const desc = document.createElement("div");
    desc.className = "item-desc";
    desc.title = item.descricao || "";
    desc.textContent = item.descricao || "";

    const val = document.createElement("div");
    if (filled) {
      val.className = "item-val";
      val.textContent = `R$ ${formatValor(item.valorUnitario)}`;
    } else {
      val.style.cssText = "font-size:10px;color:#dc2626;";
      val.textContent = "sem valor";
    }

    const status = document.createElement("div");
    status.className = "item-status";
    status.textContent = filled ? "✅" : "⚠️";

    row.append(check, num, desc, val, status);
    list.appendChild(row);
  });
}

function toggleItem(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  updateSelCount();
  renderItems();
}

function selectAll() {
  selectedIds = new Set(allItems.map((i) => i.id));
  renderItems();
  updateSelCount();
}

function selectFilled() {
  selectedIds = new Set(allItems.filter((i) => i.valorUnitario && i.marcaFabricante).map((i) => i.id));
  renderItems();
  updateSelCount();
}

function clearSel() {
  selectedIds = new Set();
  renderItems();
  updateSelCount();
}

function updateStats() {
  const filled = allItems.filter((i) => i.valorUnitario && i.marcaFabricante).length;
  document.getElementById("stat-total").textContent = allItems.length;
  document.getElementById("stat-prontos").textContent = filled;
  updateSelCount();
}

function updateSelCount() {
  document.getElementById("sel-count").textContent = selectedIds.size;
}

// ─── Run Bot ──────────────────────────────────────────────────────────────────
async function runBot() {
  if (running) return;
  if (!currentTab?.id) { addLog("error", "Sem aba ativa"); return; }
  if (selectedIds.size === 0) { addLog("error", "Selecione pelo menos um item"); return; }

  const toFill = allItems.filter((i) => selectedIds.has(i.id) && i.valorUnitario && i.marcaFabricante);
  if (toFill.length === 0) {
    addLog("error", "Nenhum item selecionado tem valor unitário e marca preenchidos.");
    return;
  }

  try {
    await chrome.tabs.sendMessage(currentTab.id, { action: "ping" });
  } catch (_) {
    addLog("error", "Recarregue a página do ComprasNet e tente novamente.");
    return;
  }

  running = true;

  document.getElementById("run-btn").style.display = "none";
  document.getElementById("controles-bot").style.display = "flex";
  const pauseBtn = document.getElementById("pause-btn");
  if (pauseBtn) pauseBtn.textContent = "⏸ Pausar";
  document.getElementById("progress-wrap").style.display = "block";
  document.getElementById("log-area").style.display = "block";

  const delay = parseInt(document.getElementById("delay-select").value, 10);
  const payload = toFill.map((i) => ({
    item: i.numeroItem,
    valorUnitario: formatValor(i.valorUnitario),
    marcaFabricante: i.marcaFabricante,
    modeloVersao: i.modeloVersao || "",
  }));

  addLog("info", `Iniciando: ${payload.length} itens, delay ${delay}ms`);
  setProgress(0, payload.length);

  try {
    const pageScan = await readPage({ quiet: true });
    if (pageScan?.recognizedFields) {
      addLog("info", `Leitura automática: ${pageScan.recognizedFields} campo(s), ${pageScan.itemCount} item(ns) mapeado(s).`);
    } else {
      addLog("warn", "A leitura inicial não encontrou campos; o bot tentará após expandir cada item.");
    }

    const result = await chrome.tabs.sendMessage(currentTab.id, {
      action: "fill_items",
      items: payload,
      delay,
    });

    if (result?.ok) {
      const clicados = (result.savedItems || []).length;
      const confirmados = (result.salvamentos || []).filter((s) => s.clicado && s.confirmado).length;
      addLog(
        "success",
        `✅ ${result.filled}/${result.total} itens preenchidos · 💾 ${clicados} com Salvar clicado · ✔ ${confirmados} confirmados pelo site`,
      );

      // Relatório do Salvar, item a item (é o que diz se o site gravou).
      for (const registro of result.salvamentos || []) {
        if (registro.recusado) {
          addLog(
            "error",
            `💾 Item ${registro.item}: o site RECUSOU o salvamento — ${registro.motivo}. Não marquei como enviado; ajuste o item e rode de novo.`,
          );
        } else if (registro.clicado && registro.confirmado) {
          const via = registro.modal?.clicado
            ? `confirmei na janela do site ("${registro.modal.botao}")`
            : registro.mensagemSucesso
              ? `o site mostrou "${registro.mensagemSucesso}"`
              : `botão "${registro.botao}"`;
          const lancamentos = registro.lancamentos?.valorUnitario;
          const notaValor = lancamentos > 1 ? ` (o valor foi lançado ${lancamentos}× até a máscara aceitar)` : "";
          addLog("success", `💾 Item ${registro.item}: salvo${registro.tentativas > 1 ? " na 2ª tentativa" : ""} — ${via}.${notaValor}`);
        } else if (registro.clicado) {
          const valores = registro.valores
            ? Object.entries(registro.valores)
                .map(([campo, valor]) => `${campo}="${valor || "(vazio)"}"`)
                .join(", ")
            : "";
          const detalhes = [
            registro.botaoPistas ? `botão: ${registro.botaoPistas}` : "",
            valores ? `na página: ${valores}` : "",
            registro.mensagens?.length ? `site mostrou: ${registro.mensagens.join(" | ")}` : "",
            registro.diagnostico?.camposDoItem
              ? `campos vazios no painel: ${registro.diagnostico.camposDoItem.vazios}/${registro.diagnostico.camposDoItem.total}`
              : "",
            registro.modal?.texto ? `janela do site: "${registro.modal.texto}"` : "",
            registro.botaoHtml ? `HTML do botão: ${registro.botaoHtml}` : "",
          ]
            .filter(Boolean)
            .join(" · ");
          addLog(
            "warn",
            `💾 Item ${registro.item}: cliquei ${registro.tentativas > 1 ? "2× " : ""}em "${registro.botao}" e o site não confirmou. Marquei como enviado; confira na página.${detalhes ? ` (${detalhes})` : ""}`,
          );
        } else {
          addLog(
            "error",
            `💾 Item ${registro.item}: NÃO salvei — ${registro.motivo || "botão Salvar não encontrado"}. Não marquei como enviado.${registro.botaoPistas ? ` (${registro.botaoPistas})` : ""}`,
          );
        }
      }

      if (result.camposProblematicos?.length) {
        for (const campo of result.camposProblematicos) {
          addLog(
            "warn",
            `📝 Campo "${campo.campo}" ficou com "${campo.valor}" e o site não registrou${campo.invalido ? " (marcado como inválido)" : ""}. O site pode exigir outro formato.`,
          );
        }
      }
      if (result.errors?.length) result.errors.forEach((error) => addLog("error", error));
      if (result.warnings?.length) result.warnings.forEach((warning) => addLog("warn", warning));
      setProgress(result.filled, result.total);

      const propostaId = document.getElementById("proposta-select").value;
      // Só marca como "enviado" no sistema o que foi realmente salvo na página.
      await marcarEnviados(propostaId, result.savedItems || []);
    } else {
      addLog("error", result?.error || "Erro desconhecido");
    }
  } catch (e) {
    addLog("error", "Erro: " + e.message);
  } finally {
    running = false;
    document.getElementById("run-btn").style.display = "flex";
    document.getElementById("controles-bot").style.display = "none";
  }
}

/** Alterna pausa/retomada do bot que está rodando na página. */
async function alternarPausa() {
  if (!currentTab?.id) return;
  const botao = document.getElementById("pause-btn");
  try {
    const estado = await chrome.tabs.sendMessage(currentTab.id, { action: "status" }).catch(() => ({}));
    const pausar = !estado?.pausado;
    await chrome.tabs.sendMessage(currentTab.id, { action: pausar ? "pause" : "resume" });
    botao.textContent = pausar ? "▶ Continuar" : "⏸ Pausar";
    addLog(pausar ? "warn" : "info", pausar ? "⏸ Bot pausado." : "▶ Bot retomado.");
  } catch (e) {
    addLog("error", "Não consegui falar com a página: " + e.message);
  }
}

/** Mostra o painel flutuante na página (com Pausar/Parar e o andamento). */
async function fixarPainelNaPagina() {
  if (!currentTab?.id) {
    addLog("warn", "Abra a página do ComprasNet primeiro.");
    return;
  }
  try {
    await chrome.tabs.sendMessage(currentTab.id, { action: "painel_mostrar" });
    addLog("info", "📌 Painel fixado na página — ele continua aberto mesmo se você fechar este popup.");
  } catch (_) {
    addLog("error", "Não consegui abrir o painel: recarregue a página do ComprasNet (F5) e tente de novo.");
  }
}

/** Abre o popup numa janela separada, que não fecha ao clicar fora. */
async function abrirJanelaFlutuante() {
  try {
    if (currentTab?.id) await chrome.storage.session.set({ janelaTabId: currentTab.id });
    await chrome.windows.create({
      url: chrome.runtime.getURL("popup.html?janela=1"),
      type: "popup",
      width: 440,
      height: 700,
    });
    window.close();
  } catch (e) {
    addLog("error", "Não consegui abrir a janela flutuante: " + e.message);
  }
}

function stopBot() {
  addLog("warn", "Parando após o item atual...");
  if (currentTab?.id) {
    chrome.tabs.sendMessage(currentTab.id, { action: "stop" }).catch(() => {});
  }
}

/**
 * Marca no sistema os itens que o bot preencheu (campo `enviado`),
 * para o painel mostrar o progresso real da proposta.
 */
async function marcarEnviados(propostaId, numeros) {
  if (!propostaId || !apiUrl || !numeros?.length) return;

  const alvos = allItems.filter((i) => numeros.includes(i.numeroItem) && !i.enviado);
  if (alvos.length === 0) return;

  let ok = 0;
  for (const item of alvos) {
    try {
      const res = await fetch(`${apiUrl}/api/propostas/${propostaId}/itens/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enviado: true }),
      });
      if (res.ok) {
        item.enviado = true;
        ok++;
      }
    } catch (_) {
      // falha silenciosa: não atrapalha o resultado do preenchimento
    }
  }

  if (ok > 0) addLog("info", `${ok} item(ns) marcado(s) como enviado(s) no sistema.`);
}

/** Valor unitário no formato do portal: 4 casas decimais ("44,0000"). */
function formatValor(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toFixed(4).replace(".", ",");
}

// ─── Progress & Logs ─────────────────────────────────────────────────────────
function setProgress(current, total) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  document.getElementById("progress-bar").style.width = pct + "%";
  document.getElementById("progress-pct").textContent = pct + "%";
  document.getElementById("progress-text").textContent =
    current === total ? "Concluído! ✅" : `Item ${current}/${total}`;
}

/** Copia o relatório do log (para mandar no suporte/diagnóstico). */
async function copiarRelatorio() {
  const area = document.getElementById("log-area");
  const botao = document.getElementById("copy-log-btn");
  if (!area || !botao) return;

  const texto = area.innerText.trim();
  if (!texto) return;

  const avisar = (ok) => {
    botao.textContent = ok ? "✅ Copiado!" : "⚠️ Não consegui copiar";
    setTimeout(() => {
      botao.textContent = "📋 Copiar relatório";
    }, 2000);
  };

  try {
    await navigator.clipboard.writeText(texto);
    avisar(true);
    return;
  } catch (_) {
    // popups antigos sem permissão de clipboard: cai no execCommand
  }

  try {
    const campo = document.createElement("textarea");
    campo.value = texto;
    campo.style.position = "fixed";
    campo.style.opacity = "0";
    document.body.appendChild(campo);
    campo.select();
    const ok = document.execCommand("copy");
    campo.remove();
    avisar(ok);
  } catch (_) {
    avisar(false);
  }
}

function addLog(type, msg) {
  const area = document.getElementById("log-area");
  if (!area) return;
  const acoes = document.getElementById("log-actions");
  if (acoes) acoes.style.display = "flex";
  const line = document.createElement("div");
  line.className = `log-${type}`;
  const time = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  line.textContent = `${time} ${type === "success" ? "✓" : type === "error" ? "✗" : type === "warn" ? "⚠" : "ℹ"} ${msg}`;
  area.appendChild(line);
  area.scrollTop = area.scrollHeight;
}

// ─── Atualização da extensão ─────────────────────────────────────────────────
// O Chrome não permite que uma extensão "sem compactação" se atualize sozinha.
// Então o combinado é: aqui o popup avisa (e o background pinta o badge 🤖),
// e a página atualizar.html grava os arquivos novos na pasta da extensão.
const VERSAO_INSTALADA = chrome.runtime.getManifest().version;

function setUpdateStatus(tipo, html) {
  const el = document.getElementById("update-status");
  if (!el) return;
  el.className = `alert alert-${tipo} mt-2`;
  el.innerHTML = html;
}

function renderNovidades(novidades) {
  const el = document.getElementById("update-novidades");
  if (!el) return;
  if (!Array.isArray(novidades) || novidades.length === 0) {
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = novidades
    .map(
      (n) => `
      <div class="text-xs" style="margin-bottom:8px; line-height:1.6;">
        <strong>Novidades da v${n.versao}</strong>
        <ul style="padding-left:16px; margin-top:2px;">${(n.itens || [])
          .map((i) => `<li>${i}</li>`)
          .join("")}</ul>
      </div>`,
    )
    .join("");
}

function mostrarAvisoAtualizacao(info) {
  const el = document.getElementById("update-notice");
  if (!el) return;
  if (info?.precisaAtualizar) {
    el.classList.remove("hidden");
    el.textContent = `🔄 Versão ${info.versao} disponível — clique para atualizar (você tem a ${VERSAO_INSTALADA}).`;
  } else {
    el.classList.add("hidden");
  }
}

async function verificarAtualizacao({ silencioso = true } = {}) {
  const instalada = VERSAO_INSTALADA;
  const elInstalada = document.getElementById("versao-instalada");
  if (elInstalada) elInstalada.textContent = instalada;

  if (!apiUrl) {
    if (!silencioso) setUpdateStatus("warning", "Configure a URL do sistema acima para verificar atualizações.");
    return null;
  }

  if (!silencioso) setUpdateStatus("info", "Consultando a versão publicada...");

  try {
    const res = await fetch(`${apiUrl}/api/extensao/versao?instalada=${encodeURIComponent(instalada)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const info = await res.json();

    const wrap = document.getElementById("versao-publicada-wrap");
    const elPublicada = document.getElementById("versao-publicada");
    if (wrap) wrap.classList.remove("hidden");
    if (elPublicada) elPublicada.textContent = info.versao;

    renderNovidades(info.novidades);
    await chrome.storage.local.set({ updateInfo: { ...info, em: Date.now() } });
    mostrarAvisoAtualizacao(info);

    if (info.precisaAtualizar) {
      setUpdateStatus("warning", `Versão <strong>${info.versao}</strong> disponível. Clique em <strong>⚡ Atualizar</strong> (ou baixe o ZIP).`);
      chrome.action.setBadgeText({ text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#d97706" });
    } else if (info.adiantada) {
      setUpdateStatus("info", `Sua versão (${instalada}) é mais nova que a publicada (${info.versao}).`);
    } else {
      setUpdateStatus("success", `Tudo em dia: versão <strong>${instalada}</strong> é a mais recente. ✅`);
      chrome.action.setBadgeText({ text: "" });
    }
    return info;
  } catch (erro) {
    if (silencioso) {
      const { updateInfo } = await chrome.storage.local.get(["updateInfo"]);
      if (updateInfo?.precisaAtualizar) mostrarAvisoAtualizacao(updateInfo);
    } else {
      setUpdateStatus("warning", `Não consegui consultar agora (${erro.message}). Tente de novo ou baixe o ZIP.`);
    }
    return null;
  }
}

async function iniciarAtualizacoes() {
  const { updateInfo } = await chrome.storage.local.get(["updateInfo"]);
  if (updateInfo?.precisaAtualizar) mostrarAvisoAtualizacao(updateInfo);
  await verificarAtualizacao({ silencioso: true });
}

function abrirAtualizador() {
  if (!apiUrl) { alert("Configure a URL do sistema primeiro!"); return; }
  chrome.tabs.create({ url: chrome.runtime.getURL("atualizar.html") });
  window.close();
}
