/**
 * ComprasNet Bot — Popup Script
 */

// ─── State ────────────────────────────────────────────────────────────────────
let apiUrl = "";
let allItems = [];
let selectedIds = new Set();
let running = false;
let abortFlag = false;
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
});

/**
 * Manifest V3 bloqueia handlers inline (onclick="..."): a CSP da extensao
 * so permite script-src 'self'. Entao todos os eventos sao ligados aqui.
 */
function bindEvents() {
  document.querySelectorAll('[data-action="tab"]').forEach((el) => {
    el.addEventListener("click", () => showTab(el.dataset.tab));
  });

  const on = (id, evt, fn) => document.getElementById(id)?.addEventListener(evt, fn);

  on("btn-check-page", "click", checkPage);
  on("proposta-select", "change", loadItems);
  on("btn-select-all", "click", selectAll);
  on("btn-select-filled", "click", selectFilled);
  on("btn-clear-sel", "click", clearSel);
  on("run-btn", "click", runBot);
  on("stop-btn", "click", stopBot);
  on("btn-save-config", "click", saveConfig);
  on("btn-open-app", "click", openApp);
  on("btn-open-comprasnet", "click", openComprasNet);
  on("api-url", "keydown", (e) => {
    if (e.key === "Enter") saveConfig();
  });
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  if (tab?.url) {
    const el = document.getElementById("page-url");
    if (el) el.textContent = tab.url;
  }
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function showTab(name) {
  ["bot", "config", "ajuda"].forEach((t) => {
    document.getElementById(`panel-${t}`)?.classList.toggle("hidden", t !== name);
    document.getElementById(`tab-${t}`)?.classList.toggle("active", t === name);
  });
}

// ─── Page Status ──────────────────────────────────────────────────────────────
async function checkPage() {
  const badge = document.getElementById("page-status-badge");
  const text = document.getElementById("page-status-text");

  if (!currentTab?.id) {
    setStatus("idle", "Sem aba ativa");
    return;
  }

  const url = currentTab.url || "";
  if (!url.includes("comprasnet.gov.br") && !url.includes("cnetmobile.estaleiro.serpro.gov.br")) {
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

function setStatus(type, msg) {
  const badge = document.getElementById("page-status-badge");
  const text = document.getElementById("page-status-text");
  badge.className = `status-badge status-${type}`;
  text.textContent = msg;
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
      val.textContent = `R$ ${parseFloat(item.valorUnitario).toFixed(2)}`;
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

  // Get selected items data
  const toFill = allItems.filter((i) => selectedIds.has(i.id) && i.valorUnitario && i.marcaFabricante);
  if (toFill.length === 0) {
    addLog("error", "Nenhum item selecionado tem valor unitário e marca preenchidos.");
    return;
  }

  // Verify content script is loaded
  try {
    await chrome.tabs.sendMessage(currentTab.id, { action: "ping" });
  } catch (_) {
    addLog("error", "Recarregue a página do ComprasNet e tente novamente.");
    return;
  }

  running = true;
  abortFlag = false;

  // UI
  document.getElementById("run-btn").style.display = "none";
  document.getElementById("stop-btn").style.display = "flex";
  document.getElementById("progress-wrap").style.display = "block";
  document.getElementById("log-area").style.display = "block";

  const delay = parseInt(document.getElementById("delay-select").value);
  const payload = toFill.map((i) => ({
    item: i.numeroItem,
    valorUnitario: formatValor(i.valorUnitario),
    marcaFabricante: i.marcaFabricante,
    modeloVersao: i.modeloVersao || "",
  }));

  addLog("info", `Iniciando: ${payload.length} itens, delay ${delay}ms`);
  setProgress(0, payload.length);

  try {
    const result = await chrome.tabs.sendMessage(currentTab.id, {
      action: "fill_items",
      items: payload,
      delay,
    });

    if (result?.ok) {
      addLog("success", `✅ ${result.filled}/${result.total} itens preenchidos!`);
      if (result.errors?.length) {
        result.errors.forEach((e) => addLog("error", e));
      }
      setProgress(result.filled, result.total);

      // Devolve ao sistema quais itens realmente foram enviados no ComprasNet
      const propostaId = document.getElementById("proposta-select").value;
      await marcarEnviados(propostaId, result.filledItems || []);
    } else {
      addLog("error", result?.error || "Erro desconhecido");
    }
  } catch (e) {
    addLog("error", "Erro: " + e.message);
  } finally {
    running = false;
    abortFlag = false;
    document.getElementById("run-btn").style.display = "flex";
    document.getElementById("stop-btn").style.display = "none";
  }
}

function stopBot() {
  abortFlag = true;
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

function formatValor(v) {
  if (!v) return "";
  return parseFloat(v).toFixed(2).replace(".", ",");
}

// ─── Progress & Logs ─────────────────────────────────────────────────────────
function setProgress(current, total) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  document.getElementById("progress-bar").style.width = pct + "%";
  document.getElementById("progress-pct").textContent = pct + "%";
  document.getElementById("progress-text").textContent =
    current === total ? "Concluído! ✅" : `Item ${current}/${total}`;
}

function addLog(type, msg) {
  const area = document.getElementById("log-area");
  if (!area) return;
  const line = document.createElement("div");
  line.className = `log-${type}`;
  const time = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  line.textContent = `${time} ${type === "success" ? "✓" : type === "error" ? "✗" : type === "warn" ? "⚠" : "ℹ"} ${msg}`;
  area.appendChild(line);
  area.scrollTop = area.scrollHeight;
}
