/**
 * ComprasNet Bot — Popup Script
 */

// ─── State ────────────────────────────────────────────────────────────────────
let apiUrl = "";
let allItems = [];
let selectedIds = new Set();
let running = false;
let currentTab = null;
let disputaSituacoes = new Map();

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const cfg = await chrome.storage.local.get(["apiUrl", "delayMs"]);
  apiUrl = cfg.apiUrl || "";
  document.getElementById("api-url").value = apiUrl;
  aplicarVelocidadeNaTela(cfg.delayMs);

  bindEvents();
  if (new URLSearchParams(location.search).get("modo") === "disputa") showTab("disputa");
  await getCurrentTab();
  await sincronizarEstadoDisputaPopup();
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
  if (msg?.action === "disputa_progress") {
    atualizarBloqueioDisputaPopup(Boolean(msg.ativo), msg.propostaId);
    if (Array.isArray(msg.situacoes)) {
      disputaSituacoes = new Map(msg.situacoes.map((s) => [String(s.numeroItem), s]));
      renderDisputaItems();
    }
    setDisputaStatus(msg.tipo || "info", msg.status || "Monitoramento atualizado.");
    return;
  }
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

function atualizarBloqueioDisputaPopup(ativo, propostaId = "") {
  const select = document.getElementById("disputa-proposta-select");
  const principal = document.getElementById("proposta-select");
  const iniciar = document.getElementById("disputa-start-btn");
  const parar = document.getElementById("disputa-stop-btn");
  if (ativo && propostaId) {
    if (select) select.value = String(propostaId);
    if (principal) principal.value = String(propostaId);
  }
  if (select) select.disabled = Boolean(ativo);
  if (principal) principal.disabled = Boolean(ativo);
  if (iniciar) {
    iniciar.disabled = Boolean(ativo);
    if (ativo) iniciar.textContent = "⚔️ Monitorando…";
    else iniciar.textContent = "▶ Iniciar envio automático";
  }
  if (parar) parar.disabled = !ativo;
}

async function sincronizarEstadoDisputaPopup() {
  try {
    if (!currentTab?.id || !isComprasNetPage(currentTab.url || "")) { atualizarBloqueioDisputaPopup(false); return; }
    const estado = await chrome.tabs.sendMessage(currentTab.id, { action: "disputa_status" });
    atualizarBloqueioDisputaPopup(Boolean(estado?.ativo), estado?.propostaId || "");
    if (estado?.ativo) iniciarAtualizacaoMinimosDisputaPopup();
  } catch (_) { atualizarBloqueioDisputaPopup(false); }
}

function bindEvents() {
  document.querySelectorAll('[data-action="tab"]').forEach((el) => {
    el.addEventListener("click", () => showTab(el.dataset.tab));
  });

  const on = (id, evt, fn) => document.getElementById(id)?.addEventListener(evt, fn);

  on("btn-check-page", "click", checkPage);
  on("btn-read-page", "click", () => readPage());
  on("proposta-select", "change", loadItems);
  on("disputa-proposta-select", "change", () => {
    const principal = document.getElementById("proposta-select");
    const disputa = document.getElementById("disputa-proposta-select");
    if (principal && disputa && principal.value !== disputa.value) {
      principal.value = disputa.value;
      loadItems();
    } else {
      renderDisputaItems();
    }
  });
  on("btn-select-all", "click", selectAll);
  on("btn-select-filled", "click", selectFilled);

  // Velocidade: presets (0,001s, 0,03s...) e digitação livre.
  document.querySelectorAll("[data-delay]").forEach((botao) => {
    botao.addEventListener("click", async () => {
      const ms = aplicarVelocidadeNaTela(Number(botao.dataset.delay) * 1000);
      await salvarVelocidade(ms);
      atualizarVelocidadeDisputa();
      addLog("info", `⚡ Velocidade: ${formatarSegundos(ms)} entre itens (vale para digitação e esperas).`);
    });
  });
  const campoDelay = document.getElementById("delay-input");
  campoDelay?.addEventListener("change", async () => {
    const ms = aplicarVelocidadeNaTela(delayDaTela());
    await salvarVelocidade(ms);
    atualizarVelocidadeDisputa();
    addLog("info", `⚡ Velocidade: ${formatarSegundos(ms)} entre itens.`);
  });
  on("btn-clear-sel", "click", clearSel);
  on("run-btn", "click", runBot);
  on("stop-btn", "click", stopBot);
  on("pause-btn", "click", alternarPausa);
  on("pin-btn", "click", fixarPainelNaPagina);
  on("float-btn", "click", () => abrirJanelaFlutuante("bot"));
  on("disputa-pin-btn", "click", fixarPainelDisputaNaPagina);
  on("disputa-float-btn", "click", () => abrirJanelaFlutuante("disputa"));
  on("disputa-start-btn", "click", iniciarDisputaAutomaticaPopup);
  on("disputa-read-page-btn", "click", lerPaginaDisputaPopup);
  on("disputa-refresh-btn", "click", () => atualizarMinimosDisputaPopup(true));
  on("disputa-stop-btn", "click", pararDisputaAutomaticaPopup);
  on("disputa-diagnostico-btn", "click", diagnosticarCamposDisputaPopup);
  on("disputa-copy-diagnostico-btn", "click", copiarDiagnosticoDisputaPopup);
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
  ["bot", "disputa", "config", "ajuda"].forEach((t) => {
    document.getElementById(`panel-${t}`)?.classList.toggle("hidden", t !== name);
    document.getElementById(`tab-${t}`)?.classList.toggle("active", t === name);
  });
  if (name === "disputa") {
    syncDisputaPropostas();
    renderDisputaItems();
    atualizarVelocidadeDisputa();
  }
}

// ─── Page Status / Leitura ────────────────────────────────────────────────────
async function checkPage() {
  if (!currentTab?.id) {
    setStatus("idle", "Sem aba ativa");
    return;
  }

  if (!isSourceItemsPage(currentTab.url || "")) {
    setStatus("warn", "Abra o ComprasNet, o CNET Mobile ou o Radar PNCP");
    return;
  }

  try {
    const resp = await chrome.tabs.sendMessage(currentTab.id, { action: "ping" });
    if (resp?.ok) {
      setStatus("ok", `${nomeFonteItens(currentTab.url || "")} detectado ✓`);
    } else {
      setStatus("warn", "Página carregando...");
    }
  } catch (_) {
    setStatus("warn", "Recarregue a página para ativar a extensão");
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

function isRadarLicitacoesPage(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.hostname.toLowerCase() === "marcossilva023l20.github.io" && /^\/radar-licitacoes-v2(?:\/|$)/.test(url.pathname);
  } catch (_) {
    return false;
  }
}

function isCnetMobilePage(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.hostname.toLowerCase() === "cnetmobile.estaleiro.serpro.gov.br" &&
      /^\/comprasnet-web\/public(?:\/|$)/i.test(url.pathname);
  } catch (_) {
    return false;
  }
}

function isSourceItemsPage(rawUrl) {
  return isRadarLicitacoesPage(rawUrl) || isComprasNetPage(rawUrl);
}

function isSourceOnlyPage(rawUrl) {
  return isRadarLicitacoesPage(rawUrl) || isCnetMobilePage(rawUrl);
}

function nomeFonteItens(rawUrl) {
  if (isRadarLicitacoesPage(rawUrl)) return "Radar PNCP";
  try {
    if (isCnetMobilePage(rawUrl)) return "CNET Mobile";
  } catch (_) {
    // URL da aba indisponível.
  }
  return "ComprasNet";
}

async function readPage({ quiet = false } = {}) {
  const button = document.getElementById("btn-read-page");
  if (!currentTab?.id) {
    setReadStatus("warning", "Não encontrei uma aba ativa para ler.");
    return null;
  }
  if (isSourceOnlyPage(currentTab.url || "")) {
    setReadStatus("warning", "Esta é uma fonte de itens. Para importar, use “📥 Ler itens da página” nesta aba.");
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
// Fluxo: lê os itens publicados no ComprasNet/CNET Mobile ou no Radar PNCP, mostra o que foi lido,
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
  if (!isSourceItemsPage(currentTab.url || "")) {
    setImportStatus("warning", "Abra uma página do ComprasNet/CNET Mobile ou do Radar de Licitações PNCP.");
    return;
  }

  const fonte = nomeFonteItens(currentTab.url || "");
  const expandir = document.getElementById("import-expandir")?.checked !== false;
  const button = document.getElementById("btn-read-items");
  if (button) {
    button.disabled = true;
    button.textContent = "⏳ Lendo itens...";
  }
  setImportStatus("info", expandir ? `Lendo itens de ${fonte} e expandindo os detalhes disponíveis...` : `Lendo itens de ${fonte}...`);
  document.getElementById("import-preview")?.classList.add("hidden");
  document.getElementById("import-envio")?.classList.add("hidden");
  document.getElementById("import-destino")?.classList.add("hidden");
  itensLidos = null;
  destinoLido = null;
  identificacaoLida = null;

  try {
    const result = await chrome.tabs.sendMessage(currentTab.id, {
      action: "read_source_items",
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
      result.origem ? `Fonte: ${result.origem}` : null,
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

// ─── Velocidade (segundos → ms) ──────────────────────────────────────────────
//
// A pausa entre itens pode ir de 0,01s a 5s. Ela é enviada para a página como
// "ritmo": o bot escala digitação, esperas e conferência por ela, então 0,03s é
// rápido de verdade (não só a pausa entre um item e outro).

const DELAY_PADRAO_MS = 1000;
const DELAY_MINIMO_MS = 1; // 0,001s — o mais rápido que o navegador entrega
const DELAY_MAXIMO_MS = 5000;

function delayDaTela() {
  const campo = document.getElementById("delay-input");
  const segundos = Number(String(campo?.value ?? "").replace(",", "."));
  if (!Number.isFinite(segundos) || segundos <= 0) return DELAY_PADRAO_MS;
  return Math.min(DELAY_MAXIMO_MS, Math.max(DELAY_MINIMO_MS, Math.round(segundos * 1000)));
}

function formatarSegundos(ms) {
  // 0,001s · 0,03s · 0,3s · 1s · 2,5s (sem zeros à toa no fim)
  const texto = (ms / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `${texto.replace(".", ",")}s`;
}

/** Mostra na tela a velocidade salva (ex.: 30 → "0.03"). */
function aplicarVelocidadeNaTela(delayMs) {
  const valor = Number(delayMs);
  const ms = Number.isFinite(valor) && valor > 0
    ? Math.min(DELAY_MAXIMO_MS, Math.max(DELAY_MINIMO_MS, valor))
    : DELAY_PADRAO_MS;
  const campo = document.getElementById("delay-input");
  if (campo) campo.value = String(Number((ms / 1000).toFixed(3)));
  return ms;
}

async function salvarVelocidade(delayMs) {
  try {
    await chrome.storage.local.set({ delayMs });
  } catch (_) {
    // sem preferência salva: o popup continua mandando a velocidade na mensagem
  }
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
    syncDisputaPropostas();
    renderDisputaItems();
    return;
  }

  try {
    const res = await fetch(`${apiUrl}/api/propostas`);
    const data = await res.json();

    const sel = document.getElementById("proposta-select");
    if (!Array.isArray(data) || data.length === 0) {
      sel.innerHTML = '<option value="">Nenhuma proposta cadastrada</option>';
      syncDisputaPropostas();
      renderDisputaItems();
      return;
    }

    sel.innerHTML = '<option value="">-- Selecione a proposta --</option>';
    data.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `Nº ${p.numeroDispensa}${p.uasg ? " — " + p.uasg : ""}`;
      sel.appendChild(opt);
    });
    syncDisputaPropostas();
  } catch (e) {
    syncDisputaPropostas();
    addLog("error", "Erro ao carregar propostas: " + e.message);
  }
}

// ─── Load Items ───────────────────────────────────────────────────────────────
function syncDisputaPropostas() {
  const principal = document.getElementById("proposta-select");
  const disputa = document.getElementById("disputa-proposta-select");
  if (!principal || !disputa) return;

  const selecionada = disputa.value;
  disputa.innerHTML = principal.innerHTML;
  const existeSelecionada = [...disputa.options].some((option) => option.value === selecionada);
  disputa.value = existeSelecionada ? selecionada : principal.value;
}

function atualizarVelocidadeDisputa() {
  const label = document.getElementById("disputa-speed");
  if (label) label.textContent = "Modo Disputa acompanha as atualizações da página; não altera a velocidade do Modo Proposta.";
}

function renderDisputaItems() {
  const card = document.getElementById("disputa-items-card");
  const list = document.getElementById("disputa-items-list");
  const select = document.getElementById("disputa-proposta-select");
  if (!card || !list || !select) return;

  const propostaSelecionada = select.value;
  const propostaPrincipal = document.getElementById("proposta-select")?.value || "";
  if (!propostaSelecionada || propostaSelecionada !== propostaPrincipal) {
    card.style.display = "none";
    list.innerHTML = "";
    return;
  }

  card.style.display = "block";
  list.innerHTML = "";
  if (!Array.isArray(allItems) || allItems.length === 0) {
    const vazio = document.createElement("div");
    vazio.className = "text-xs";
    vazio.textContent = "Nenhum item cadastrado nesta proposta.";
    list.appendChild(vazio);
    return;
  }

  allItems.forEach((item) => {
    const row = document.createElement("div");
    row.className = "item-row";

    const num = document.createElement("div");
    num.className = "item-num";
    num.textContent = String(item.numeroItem);

    const desc = document.createElement("div");
    desc.className = "item-desc";
    desc.title = item.descricao || "";
    desc.textContent = item.descricao || "(sem descrição)";

    const values = document.createElement("div");
    values.style.cssText = "font-size:9px;color:#475569;text-align:right;white-space:nowrap;";
    const temAtual = item.valorUnitario !== null && item.valorUnitario !== undefined && item.valorUnitario !== "";
    const temMinimo = item.valorMinimo !== null && item.valorMinimo !== undefined && item.valorMinimo !== "";
    const atual = temAtual ? `Atual ${formatValor(item.valorUnitario)}` : "Sem preço";
    const minimo = temMinimo ? `Mín. ${formatValor(item.valorMinimo)}` : "Mín. não informado";
    const situacao = disputaSituacoes.get(String(item.numeroItem));
    const indicador = situacao?.estado === "perdendo" ? " · 👎 perdendo (vermelho)"
      : situacao?.estado === "vencendo" ? " · 👍 vencendo (verde)"
        : situacao ? " · estado incerto — sem lance" : " · estado aguarda leitura da página";
    values.textContent = `${atual} · ${minimo}${indicador}`;
    if (situacao?.estado === "perdendo") values.style.color = "#dc2626";
    else if (situacao?.estado === "vencendo") values.style.color = "#168821";
    values.title = `Valor unitário: ${temAtual ? formatValor(item.valorUnitario) : "não informado"}; Valor Mínimo: ${temMinimo ? formatValor(item.valorMinimo) : "não informado"}; estado: ${situacao?.estado || "não lido"}`;

    row.append(num, desc, values);
    list.appendChild(row);
  });
}

function setDisputaStatus(tipo, mensagem) {
  const el = document.getElementById("disputa-availability");
  if (!el) return;
  const classe = ["info", "warning", "success"].includes(tipo) ? tipo : "info";
  el.className = `alert alert-${classe}`;
  el.textContent = String(mensagem || "");
}

let disputaPollTimer = null;
let disputaPollEmCurso = false;

function pararAtualizacaoMinimosDisputaPopup() {
  if (disputaPollTimer) clearInterval(disputaPollTimer);
  disputaPollTimer = null;
}

function iniciarAtualizacaoMinimosDisputaPopup() {
  pararAtualizacaoMinimosDisputaPopup();
  atualizarMinimosDisputaPopup();
  disputaPollTimer = setInterval(() => atualizarMinimosDisputaPopup(false), 10000);
}

async function atualizarMinimosDisputaPopup(manual = false) {
  if (disputaPollEmCurso || !currentTab?.id || !isComprasNetPage(currentTab.url || "")) return;
  disputaPollEmCurso = true;
  const botao = document.getElementById("disputa-refresh-btn");
  if (botao) botao.disabled = true;
  try {
    const estado = await chrome.tabs.sendMessage(currentTab.id, { action: "disputa_status" });
    if (!manual && !estado?.ativo) {
      atualizarBloqueioDisputaPopup(false);
      pararAtualizacaoMinimosDisputaPopup();
      return;
    }
    const propostaId = document.getElementById("disputa-proposta-select")?.value;
    if (!propostaId) return;
    if (!apiUrl) throw new Error("Configure a URL do sistema na aba Config.");
    if (estado?.ativo && estado.propostaId && estado.propostaId !== propostaId) {
      setDisputaStatus("warning", "O monitoramento usa outra proposta. Pare-o antes de trocar ou atualizar os valores exibidos.");
      return;
    }
    const url = `${apiUrl}/api/propostas/${encodeURIComponent(propostaId)}/itens?disputa_minimos=${Date.now()}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const itens = await response.json();
    if (document.getElementById("disputa-proposta-select")?.value !== propostaId) return;
    allItems = Array.isArray(itens) ? itens : [];
    const hora = new Date().toLocaleTimeString("pt-BR");
    disputaSituacoes = new Map((estado.situacoes || []).map((s) => [String(s.numeroItem), s]));
    renderDisputaItems();
    const aviso = estado.ativo ? estado.pausado ? "Monitoramento pausado" : "Monitoramento ativo" : "Consulta manual";
    const perdendo = [...disputaSituacoes.values()].filter((s) => s.estado === "perdendo").length;
    const vencendo = [...disputaSituacoes.values()].filter((s) => s.estado === "vencendo").length;
    const incertos = disputaSituacoes.size - perdendo - vencendo;
    const stop = Array.isArray(estado.itensNoPiso) && estado.itensNoPiso.length ? ` Itens pausados no piso: ${estado.itensNoPiso.join(", ")}; altere o Valor Mínimo no sistema para reavaliá-los.` : "";
    const prefixo = estado.ativo ? ` · Situação visível: ${perdendo} perdendo/vermelho, ${vencendo} vencendo/verde, ${Math.max(0, incertos)} incerto(s).` : "";
    setDisputaStatus(estado.pausado ? "warning" : "info", `${aviso} · Valores Mínimos atualizados às ${hora}${prefixo}. Só polegar para baixo vermelho pode gerar lance; o content script confere compra e piso antes do clique.${stop}`);
  } catch (erro) {
    setDisputaStatus("warning", `Não consegui atualizar os Valores Mínimos (${erro?.message || "erro"}). Nenhum lance é enviado sem validação atual no content script.`);
  } finally {
    disputaPollEmCurso = false;
    if (botao) botao.disabled = false;
  }
}

function setDisputaReadStatus(tipo, mensagem) {
  const statusEl = document.getElementById("disputa-read-status");
  if (!statusEl) return;
  statusEl.classList.remove("hidden", "alert-info", "alert-warning", "alert-success");
  const classe = tipo === "warning" ? "alert-warning" : tipo === "success" ? "alert-success" : "alert-info";
  statusEl.classList.add(classe);
  statusEl.textContent = mensagem;
}

async function lerPaginaDisputaPopup() {
  if (!currentTab?.id || !isComprasNetPage(currentTab.url || "")) {
    setDisputaReadStatus("warning", "Abra a tela “Enviar lance” do Compras.gov.br antes de ler a página.");
    return;
  }
  const botao = document.getElementById("disputa-read-page-btn");
  if (botao) {
    botao.disabled = true;
    botao.textContent = "⏳ Lendo...";
  }
  setDisputaReadStatus("info", "Analisando os campos de lance, polegares e botões de envio da página...");
  try {
    const resultado = await chrome.tabs.sendMessage(currentTab.id, { action: "disputa_ler_pagina" });
    if (!resultado?.ok) {
      setDisputaReadStatus("warning", resultado?.error || "Não consegui ler os campos da página.");
      setDisputaStatus("warning", resultado?.error || "Falha na leitura da página.");
      return;
    }
    // Atualiza as situações com o que foi lido
    if (resultado.situacoes) {
      disputaSituacoes = new Map(resultado.situacoes.map((s) => [String(s.numeroItem), s]));
      renderDisputaItems();
    }
    setDisputaReadStatus("success", resultado.message || "Página lida com sucesso: campos de lance identificados.");
    setDisputaStatus("success", resultado.message || "Página lida; campos de lance mapeados.");
  } catch (erro) {
    setDisputaReadStatus("warning", `Não consegui ler a página. Recarregue o ComprasNet e tente novamente (${erro?.message || "erro"}).`);
    setDisputaStatus("warning", "Falha ao ler a página.");
  } finally {
    if (botao) {
      botao.disabled = false;
      botao.textContent = "📖 Ler página";
    }
  }
}

async function diagnosticarCamposDisputaPopup() {
  if (!currentTab?.id || !isComprasNetPage(currentTab.url || "")) {
    setDisputaStatus("warning", "Abra a tela “Enviar lance” do Compras.gov.br antes de diagnosticar.");
    return;
  }
  const botao = document.getElementById("disputa-diagnostico-btn");
  const area = document.getElementById("disputa-diagnostico-area");
  const texto = document.getElementById("disputa-diagnostico-texto");
  if (botao) botao.disabled = true;
  area?.classList.add("hidden");
  if (texto) texto.value = "";
  setDisputaStatus("info", "Lendo os campos da tela, sem preencher nem enviar lances…");
  try {
    const resultado = await chrome.tabs.sendMessage(currentTab.id, { action: "disputa_diagnosticar" });
    if (!resultado?.ok || !resultado?.diagnostico) {
      setDisputaStatus("warning", resultado?.error || "Não consegui ler o diagnóstico da página.");
      return;
    }
    if (texto) texto.value = JSON.stringify({ versaoExtensao: VERSAO_INSTALADA, abaAlvo: currentTab.id, ...resultado.diagnostico }, null, 2);
    area?.classList.remove("hidden");
    setDisputaStatus("info", resultado.message || "Diagnóstico somente leitura concluído. Use Copiar diagnóstico para compartilhar a leitura.");
  } catch (erro) {
    setDisputaStatus("warning", `Não consegui diagnosticar. Recarregue a página (F5) depois de atualizar a extensão (${erro?.message || "erro"}).`);
  } finally {
    if (botao) botao.disabled = false;
  }
}

async function copiarDiagnosticoDisputaPopup() {
  const area = document.getElementById("disputa-diagnostico-texto");
  if (!area?.value) return;
  try {
    await navigator.clipboard.writeText(area.value);
    setDisputaStatus("success", "Diagnóstico copiado. Pode colá-lo no suporte; copiar não inicia nem envia lances.");
  } catch (_) {
    area.focus();
    area.select();
    let copiado = false;
    try { copiado = typeof document.execCommand === "function" && document.execCommand("copy"); } catch (_) { /* usa Ctrl+C manualmente */ }
    setDisputaStatus(copiado ? "success" : "warning", copiado ? "Diagnóstico copiado." : "Selecione o texto do diagnóstico e use Ctrl+C para copiar manualmente.");
  }
}

async function iniciarDisputaAutomaticaPopup() {
  const propostaId = document.getElementById("disputa-proposta-select")?.value;
  if (!propostaId) {
    setDisputaStatus("warning", "Selecione a proposta correspondente à dispensa e à UASG desta página.");
    return;
  }
  if (!currentTab?.id) {
    setDisputaStatus("warning", "Não encontrei a aba de disputa ativa.");
    return;
  }
  if (!isComprasNetPage(currentTab.url || "")) {
    setDisputaStatus("warning", "Abra no navegador a tela “Enviar lance” do Compras.gov.br/ComprasNet antes de iniciar.");
    return;
  }

  const botao = document.getElementById("disputa-start-btn");
  let iniciou = false;
  if (botao) {
    botao.disabled = true;
    botao.textContent = "⏳ Validando disputa…";
  }
  setDisputaStatus("info", "Validando número da dispensa, UASG, itens e Valores Mínimos. O portal pedirá confirmação antes de iniciar.");
  try {
    const resultado = await chrome.tabs.sendMessage(currentTab.id, { action: "disputa_start", propostaId });
    if (!resultado?.ok) {
      setDisputaStatus(resultado?.canceled ? "info" : "warning", resultado?.error || "Não consegui iniciar o Modo Disputa.");
      if (resultado?.error) addLog("warn", `Modo Disputa: ${resultado.error}`);
      await sincronizarEstadoDisputaPopup();
      return;
    }
    iniciou = true;
    atualizarBloqueioDisputaPopup(true, resultado.propostaId || propostaId);
    setDisputaStatus("success", resultado.message || "Monitoramento iniciado: só polegar vermelho para baixo envia; o piso será conferido antes de cada clique.");
    addLog("success", `⚔️ ${resultado.message || "Modo Disputa iniciado."}`);
    iniciarAtualizacaoMinimosDisputaPopup();
  } catch (erro) {
    setDisputaStatus("warning", `Não consegui conversar com a página. Recarregue a tela “Enviar lance” e tente novamente (${erro?.message || "erro"}).`);
  } finally {
    if (botao && !iniciou) {
      botao.disabled = false;
      botao.textContent = "▶ Iniciar envio automático";
    }
  }
}

async function pararDisputaAutomaticaPopup() {
  if (!currentTab?.id) {
    setDisputaStatus("warning", "Não encontrei a aba de disputa ativa.");
    return;
  }
  const botao = document.getElementById("disputa-stop-btn");
  if (botao) botao.disabled = true;
  try {
    const resultado = await chrome.tabs.sendMessage(currentTab.id, { action: "disputa_stop" });
    setDisputaStatus(resultado?.stopped ? "warning" : "info", resultado?.message || "Comando de parada enviado.");
    if (resultado?.stopped) {
      atualizarBloqueioDisputaPopup(false);
      pararAtualizacaoMinimosDisputaPopup();
      addLog("warn", "⏹ Monitoramento de disputa parado pelo usuário.");
    }
  } catch (erro) {
    setDisputaStatus("warning", `Não consegui parar pela extensão (${erro?.message || "erro"}). Use ⏹ Parar no painel da página.`);
  } finally {
    if (botao) botao.disabled = false;
  }
}

async function fixarPainelDisputaNaPagina() {
  if (!currentTab?.id) {
    addLog("warn", "Abra a página do ComprasNet primeiro.");
    return;
  }
  try {
    await chrome.tabs.sendMessage(currentTab.id, { action: "painel_mostrar", modo: "disputa" });
    addLog("info", "📌 Painel flutuante do Modo Disputa aberto. Inicie somente após conferir proposta, UASG e Valor Mínimo.");
  } catch (_) {
    addLog("error", "Não consegui abrir o painel: recarregue a página do ComprasNet (F5) e tente de novo.");
  }
}

async function loadItems() {
  const propostaId = document.getElementById("proposta-select").value;
  const disputaSelect = document.getElementById("disputa-proposta-select");
  if (disputaSelect && disputaSelect.value !== propostaId) disputaSelect.value = propostaId;
  if (!propostaId) {
    allItems = [];
    document.getElementById("stats-grid").style.display = "none";
    document.getElementById("items-card").style.display = "none";
    document.getElementById("run-card").style.display = "none";
    renderDisputaItems();
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
    renderDisputaItems();

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
  if (!isComprasNetPage(currentTab.url || "") || isSourceOnlyPage(currentTab.url || "")) {
    addLog("error", "Esta página é apenas uma fonte de itens. Para preencher, abra a tela de cadastro de propostas do ComprasNet.");
    return;
  }
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

  const delay = delayDaTela();
  await salvarVelocidade(delay);
  const payload = toFill.map((i) => ({
    item: i.numeroItem,
    valorUnitario: formatValor(i.valorUnitario),
    marcaFabricante: i.marcaFabricante,
    modeloVersao: i.modeloVersao || "",
  }));

  addLog("info", `Iniciando: ${payload.length} itens · velocidade ${formatarSegundos(delay)} entre itens`);
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
            `📝 Campo "${campo.campo}" ficou com "${campo.valor}"${campo.esperado ? ` (esperado: ${campo.esperado})` : ""} e o site não registrou${campo.invalido ? " (marcado como inválido)" : ""}. O site pode exigir outro formato.`,
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
    await chrome.tabs.sendMessage(currentTab.id, { action: "painel_mostrar", modo: "proposta" });
    addLog("info", "📌 Painel fixado na página — ele continua aberto mesmo se você fechar este popup.");
  } catch (_) {
    addLog("error", "Não consegui abrir o painel: recarregue a página do ComprasNet (F5) e tente de novo.");
  }
}

/** Abre o popup numa janela separada, que não fecha ao clicar fora. */
async function abrirJanelaFlutuante(modo = "bot") {
  try {
    if (currentTab?.id) await chrome.storage.session.set({ janelaTabId: currentTab.id, janelaModo: modo });
    const query = new URLSearchParams({ janela: "1", modo });
    await chrome.windows.create({
      url: `${chrome.runtime.getURL("popup.html")}?${query.toString()}`,
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
