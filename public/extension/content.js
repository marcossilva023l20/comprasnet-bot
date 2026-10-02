/**
 * ComprasNet Preenchedor de Propostas — Content Script
 * Analisa os campos visíveis da página e preenche apenas os campos identificados.
 */

let abortRequested = false;
let latestScanState = null;

const FIELD_LABELS = {
  valorUnitario: "valor unitário",
  marcaFabricante: "marca/fabricante",
  modeloVersao: "modelo/versão",
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "ping") {
    sendResponse({ ok: true, url: location.href });
    return true;
  }

  if (msg.action === "stop") {
    abortRequested = true;
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === "scan_page" || msg.action === "read_page") {
    sendResponse(scanPage());
    return true;
  }

  // Mantido para compatibilidade com versões anteriores da extensão.
  if (msg.action === "get_page_items") {
    const result = scanPage();
    sendResponse({ ok: true, items: result.items, fields: result.fields });
    return true;
  }

  if (msg.action === "read_comprasnet_items") {
    readPageItems({
      expandir: msg.expandir !== false,
      delay: Number(msg.delay) || 400,
    })
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === "fill_items") {
    fillItems(Array.isArray(msg.items) ? msg.items : [], Number(msg.delay) || 800)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// ─── Leitura da página ────────────────────────────────────────────────────────

function scanPage() {
  const itemGroups = new Map();
  const unassignedFields = new Map();
  const fieldCounts = {
    valorUnitario: 0,
    marcaFabricante: 0,
    modeloVersao: 0,
  };
  let visibleControls = 0;

  for (const doc of collectDocuments()) {
    const controls = doc.querySelectorAll(
      'input, textarea, select, [contenteditable="true"], [role="textbox"]'
    );

    for (const control of controls) {
      if (!isFillable(control) || !isVisible(control)) continue;
      visibleControls++;

      const field = classifyField(control);
      if (!field) continue;

      const itemContext = findItemContext(control);
      const destination = itemContext
        ? getOrCreateItemGroup(itemGroups, itemContext.number, itemContext.container)
        : unassignedFields;

      if (!destination.has(field)) {
        destination.set(field, control);
        fieldCounts[field]++;
      } else if (getControlConfidence(control, field) > getControlConfidence(destination.get(field), field)) {
        destination.set(field, control);
      }
    }
  }

  const items = [...itemGroups.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([item, group]) => ({
      item,
      fields: [...group.fields.keys()],
      complete: group.fields.has("valorUnitario") && group.fields.has("marcaFabricante"),
    }));

  const mappedFieldCount = [...itemGroups.values()].reduce(
    (total, group) => total + group.fields.size,
    0,
  ) + unassignedFields.size;

  const result = {
    ok: true,
    url: location.href,
    title: document.title,
    visibleControls,
    itemCount: items.length,
    recognizedFields: mappedFieldCount,
    fieldCounts,
    unassignedFields: [...unassignedFields.keys()],
    items,
  };

  latestScanState = { itemGroups, unassignedFields, result };
  return result;
}

function collectDocuments() {
  const documents = [];
  const seen = new Set();

  function visit(doc, depth) {
    if (!doc || seen.has(doc) || depth > 5) return;
    seen.add(doc);
    documents.push(doc);

    for (const frame of doc.querySelectorAll("iframe, frame")) {
      try {
        visit(frame.contentDocument, depth + 1);
      } catch (_) {
        // O navegador bloqueia a leitura de frames de outra origem.
      }
    }
  }

  visit(document, 0);
  return documents;
}

function isFillable(el) {
  if (!el || el.disabled || el.readOnly || el.getAttribute("aria-disabled") === "true") return false;
  if (el.getAttribute("aria-readonly") === "true") return false;

  if (el.tagName === "INPUT") {
    const type = (el.type || "text").toLowerCase();
    return !["hidden", "button", "submit", "reset", "checkbox", "radio", "file", "image"].includes(type);
  }

  if (el.tagName === "BUTTON") return false;
  if (el.tagName === "SELECT" || el.tagName === "TEXTAREA") return true;
  return el.isContentEditable || el.getAttribute("role") === "textbox";
}

function classifyField(control) {
  const signals = getFieldSignals(control);
  const text = normalizeText(signals.all.join(" "));
  const valueText = normalizeText(signals.value.join(" "));
  const compactText = text.replace(/[^a-z0-9]/g, "");
  const excludesTotal = /\b(total|global|estimado|estimada|referencial|referencia|maximo|minimo)\b/.test(text);

  if (/marca|fabricante/.test(text) || /(?:txt|campo|input|field)(?:marca|fabricante)/.test(compactText)) {
    return "marcaFabricante";
  }
  if (/modelo|versao/.test(text) || /(?:txt|campo|input|field)(?:modelo|versao)/.test(compactText)) {
    return "modeloVersao";
  }

  const hasPriceWord = /\b(valor|preco|vlr|price)\b/.test(text);
  const hasUnitWord = /\b(unitario|unitaria|unit|unidade)\b/.test(text);
  const explicitUnitPrice =
    /\b(valor|preco|vlr|price)\s*(?:unitario|unitaria|unit|por unidade)\b/.test(text) ||
    /\b(unitario|unitaria|unit|por unidade)\s*(?:do|de)?\s*(?:valor|preco|vlr|price)\b/.test(text) ||
    /(?:valor|preco|vlr)[_-]?(?:unitario|unitaria)/.test(text.replace(/\s+/g, ""));

  if (explicitUnitPrice) return "valorUnitario";
  if (hasPriceWord && !excludesTotal && (hasUnitWord || /\b(valor|preco|vlr|price)\b/.test(valueText))) {
    return "valorUnitario";
  }

  // Muitos formulários de compras exibem somente o placeholder 0,00 para preço.
  const placeholder = normalizeText(control.getAttribute("placeholder") || "");
  if (/^r?\$?\s*0[,.]00$/.test(placeholder) && !excludesTotal) return "valorUnitario";

  return null;
}

function getFieldSignals(control) {
  const labels = [];
  const values = [];
  const addLabel = (value) => {
    const text = String(value || "").trim();
    if (text && !labels.includes(text)) labels.push(text);
  };
  const addValue = (value) => {
    const text = String(value || "").trim();
    if (text && !values.includes(text)) values.push(text);
  };

  if (control.labels) {
    for (const label of control.labels) addLabel(label.textContent);
  }

  const doc = control.ownerDocument;
  const labelledBy = control.getAttribute("aria-labelledby") || "";
  for (const id of labelledBy.split(/\s+/).filter(Boolean)) {
    addLabel(doc.getElementById(id)?.textContent);
  }

  for (const attr of ["aria-label", "placeholder", "title", "name", "id", "data-testid"]) {
    addValue(control.getAttribute(attr));
  }
  if (typeof control.className === "string") addValue(control.className);

  const closestLabel = control.closest("label");
  if (closestLabel) addLabel(textWithoutControls(closestLabel));

  // Captura rótulos que aparecem imediatamente antes do campo e não usam for/id.
  let previous = control.previousElementSibling;
  for (let i = 0; previous && i < 2; i++, previous = previous.previousElementSibling) {
    const text = textWithoutControls(previous);
    if (text && text.length <= 100) addLabel(text);
  }

  // Componentes de formulário normalmente agrupam o rótulo e um único controle.
  let parent = control.parentElement;
  for (let depth = 0; parent && depth < 3; depth++, parent = parent.parentElement) {
    const controls = parent.querySelectorAll(
      'input:not([type="hidden"]), textarea, select, [contenteditable="true"], [role="textbox"]'
    );
    if (controls.length === 1) {
      const text = textWithoutControls(parent);
      if (text && text.length <= 120) addLabel(text);
    }

    const classAndId = `${parent.id || ""} ${typeof parent.className === "string" ? parent.className : ""}`;
    addValue(classAndId);
  }

  addLabel(getTableHeaderText(control));
  return { all: [...labels, ...values], value: values };
}

function textWithoutControls(node) {
  if (!node) return "";
  const clone = node.cloneNode(true);
  clone.querySelectorAll("input, textarea, select, button, script, style").forEach((el) => el.remove());
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

function getTableHeaderText(control) {
  const cell = control.closest("td, th");
  const table = cell?.closest("table");
  if (!cell || !table) return "";

  const column = cell.cellIndex;
  const headerRows = table.querySelectorAll("thead tr");
  for (const row of headerRows) {
    const header = row.cells[column];
    if (header?.textContent?.trim()) return header.textContent.trim();
  }

  const row = cell.parentElement;
  const previousRow = row?.previousElementSibling;
  const previousCell = previousRow?.children?.[column];
  return previousCell?.textContent?.trim() || "";
}

function getControlConfidence(control, field) {
  const signals = getFieldSignals(control);
  const text = normalizeText(signals.all.join(" "));
  const keyword = field === "valorUnitario"
    ? /valor|preco|vlr|price|0[,.]00/
    : field === "marcaFabricante"
      ? /marca|fabricante/
      : /modelo|versao/;
  return keyword.test(text) ? 1 : 0;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeItemNumber(value) {
  const digits = String(value || "").match(/\d+/)?.[0];
  return digits ? String(Number(digits)) : "";
}

function getOrCreateItemGroup(groups, itemNumber, container) {
  const key = normalizeItemNumber(itemNumber);
  let group = groups.get(key);
  if (!group) {
    group = { fields: new Map(), container: container || null };
    groups.set(key, group);
  } else if (container) {
    group.container = mergeItemContainers(group.container, container, key);
  }
  return group.fields;
}

function mergeItemContainers(current, next, itemNumber) {
  if (!current) return next;
  if (!next || current.ownerDocument !== next.ownerDocument) return current;
  if (current.contains(next)) return current;
  if (next.contains(current)) return next;

  let ancestor = current.parentElement;
  while (ancestor && !ancestor.contains(next)) ancestor = ancestor.parentElement;
  if (!ancestor || ancestor.textContent.length > 3000) return current;

  const numbers = getExplicitItemNumbers(ancestor.textContent);
  return numbers.length === 1 && numbers[0] === itemNumber ? ancestor : current;
}

function findItemContext(el) {
  const doc = el.ownerDocument;
  let node = el;
  let depth = 0;

  while (node && node !== doc.body && node !== doc.documentElement && depth < 14) {
    const attrNumber = getItemNumberFromAttributes(node);
    if (attrNumber) return { number: attrNumber, container: node };

    const text = (node.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length > 0 && text.length <= 2500) {
      const numbers = getExplicitItemNumbers(text);
      if (numbers.length === 1 && (isItemBoundary(node) || text.length <= 900)) {
        return { number: numbers[0], container: node };
      }

      if (numbers.length === 0 && isItemBoundary(node) && text.length <= 1200) {
        const leadingNumber = getLeadingItemNumber(text);
        if (leadingNumber) return { number: leadingNumber, container: node };
      }
    }

    node = node.parentElement;
    depth++;
  }

  return null;
}

function isItemBoundary(node) {
  if (!node || node.nodeType !== 1) return false;
  if (node.matches('tr, li, section, article, fieldset, [role="row"], [data-item], [data-item-number]')) return true;

  const idAndClass = `${node.id || ""} ${typeof node.className === "string" ? node.className : ""}`;
  return /(^|[\s_-])items?([\s_-]|$)/i.test(idAndClass);
}

function getItemNumberFromAttributes(node) {
  if (!node?.attributes) return "";
  const usefulNames = new Set([
    "data-item",
    "data-item-number",
    "data-item-num",
    "data-item-no",
    "data-numero-item",
  ]);

  for (const attr of node.attributes) {
    const name = attr.name.toLowerCase();
    const value = attr.value || "";
    if (usefulNames.has(name)) {
      const directNumber = normalizeItemNumber(value);
      if (directNumber) return directNumber;
    }

    if (name === "id" || name === "class") {
      const match = value.match(/(?:^|[^a-z])item(?:[_-]*(?:numero|num|no|n))?[_-]*0*(\d{1,5})(?=$|[^\d])/i);
      if (match) return normalizeItemNumber(match[1]);
    }
  }

  return "";
}

function getExplicitItemNumbers(text) {
  const normalized = normalizeText(text);
  const matches = [...normalized.matchAll(/\bitem\s*(?:n(?:umero|o|º|°|\.)?\s*)?0*(\d{1,5})\b/g)];
  return [...new Set(matches.map((match) => normalizeItemNumber(match[1])).filter(Boolean))];
}

function getLeadingItemNumber(text) {
  const normalized = normalizeText(text);
  const match = normalized.match(/^\s*0*(\d{1,5})(?:\s*[.)\-–:]\s*|\s+|$)/);
  return match ? normalizeItemNumber(match[1]) : "";
}

// ─── Preenchimento ────────────────────────────────────────────────────────────

async function fillItems(items, delayMs) {
  let filled = 0;
  const errors = [];
  const warnings = [];
  const filledItems = [];
  abortRequested = false;

  if (items.length === 0) {
    return { filled, total: 0, errors: ["Nenhum item foi enviado para preencher."], warnings, filledItems };
  }

  showNotification(`🤖 Lendo a página e preenchendo ${items.length} item(ns)...`, "info");

  for (const item of items) {
    if (abortRequested) break;

    try {
      const outcome = await fillSingleItem(item, items.length === 1);
      if (outcome.ok) {
        filled++;
        filledItems.push(item.item);
      }
      if (outcome.error) errors.push(outcome.error);
      if (outcome.warnings?.length) warnings.push(...outcome.warnings);
    } catch (err) {
      errors.push(`Item ${item.item}: ${err.message}`);
    }

    showProgressBar(filled, items.length);
    await sleep(delayMs);
  }

  removeProgressBar();

  if (abortRequested) {
    showNotification(`⏹ Parado: ${filled} de ${items.length} itens preenchidos.`, "warning");
  } else if (filled === items.length) {
    showNotification(`✅ ${filled} itens preenchidos com sucesso!`, "success");
  } else {
    showNotification(`⚠️ ${filled} de ${items.length} itens preenchidos. ${errors.length} erro(s).`, "warning");
  }

  return { filled, total: items.length, errors, warnings, filledItems, aborted: abortRequested };
}

async function fillSingleItem(item, allowUnassignedFields) {
  const itemNumber = String(item.item ?? "");
  await tryExpandItem(itemNumber);
  await sleep(250);

  scanPage();
  let fields = getFieldsForItem(itemNumber, allowUnassignedFields);
  if (!fields) {
    return {
      ok: false,
      error: `Item ${itemNumber}: não encontrei campos reconhecidos associados a este item. Expanda o item e clique em “Ler página”.`,
    };
  }

  const required = [
    { key: "valorUnitario", value: item.valorUnitario, required: true },
    { key: "marcaFabricante", value: item.marcaFabricante, required: true },
  ];
  const optional = { key: "modeloVersao", value: item.modeloVersao, required: false };
  const missing = [];
  const warnings = [];

  for (const field of [...required, optional]) {
    if (abortRequested) return { ok: false, error: `Item ${itemNumber}: preenchimento interrompido.` };
    if (!field.value) continue;

    // Releitura após cada campo: páginas React/Angular podem recriar os inputs.
    scanPage();
    fields = getFieldsForItem(itemNumber, allowUnassignedFields);
    const input = fields?.get(field.key);

    if (!input) {
      if (field.required) missing.push(FIELD_LABELS[field.key]);
      else warnings.push(`Item ${itemNumber}: campo ${FIELD_LABELS[field.key]} não localizado.`);
      continue;
    }

    const didFill = await setInputValue(input, field.value);
    if (!didFill) {
      if (field.required) missing.push(FIELD_LABELS[field.key]);
      else warnings.push(`Item ${itemNumber}: não foi possível preencher ${FIELD_LABELS[field.key]}.`);
    }
    await sleep(120);
  }

  if (missing.length) {
    return {
      ok: false,
      error: `Item ${itemNumber}: campo(s) não preenchido(s): ${missing.join(", ")}.`,
      warnings,
    };
  }

  await sleep(200);
  showNotification(`💾 Item ${itemNumber}: salvando...`, "info");
  const saved = await clickSalvar(itemNumber, allowUnassignedFields);
  if (!saved) {
    warnings.push(`Item ${itemNumber}: campos preenchidos; não localizei um botão Salvar dentro do item. Confira a página antes de enviar.`);
  }

  return { ok: true, warnings };
}

function getFieldsForItem(itemNumber, allowUnassignedFields) {
  if (!latestScanState) return null;
  const key = normalizeItemNumber(itemNumber);
  const group = latestScanState.itemGroups.get(key);
  if (group) return group.fields;

  // Só usa campos sem número de item quando há um único item sendo preenchido.
  if (allowUnassignedFields && latestScanState.itemGroups.size === 0) {
    return latestScanState.unassignedFields;
  }

  return null;
}

async function tryExpandItem(itemNumber) {
  const target = normalizeItemNumber(itemNumber);
  const visto = new Set();
  const candidatos = [];

  for (const doc of collectDocuments()) {
    for (const el of doc.querySelectorAll(
      'button, a, [role="button"], [aria-expanded], [data-toggle="collapse"], [data-bs-toggle="collapse"]',
    )) {
      if (visto.has(el) || !isVisible(el)) continue;
      visto.add(el);

      const pontos = pontuarBotaoExpandir(el);
      if (pontos <= 0) continue; // "Favoritos", "Salvar", "Imprimir"... nunca.
      if (el.getAttribute("aria-expanded") === "true") continue;

      const direto = `${el.textContent || ""} ${el.getAttribute("aria-label") || ""}`;
      const contexto = findItemContext(el);
      const combina = getExplicitItemNumbers(direto).includes(target) || contexto?.number === target;
      if (!combina) continue;

      candidatos.push({ el, pontos });
    }
  }

  candidatos.sort((a, b) => b.pontos - a.pontos);
  const melhor = candidatos[0]?.el;
  if (!melhor) return false;

  try {
    melhor.click();
  } catch (_) {
    return false;
  }
  await sleep(400);
  return true;
}

async function setInputValue(input, rawValue) {
  if (!input || !input.isConnected || !isFillable(input)) return false;

  const view = input.ownerDocument.defaultView || window;
  let value = String(rawValue ?? "");
  if (input.tagName === "INPUT" && input.type === "number") value = value.replace(",", ".");

  try {
    input.focus();
    if (typeof input.select === "function") input.select();
  } catch (_) {
    // Nem todos os componentes oferecem seleção de texto.
  }

  if (input.tagName === "SELECT") {
    const target = normalizeText(value);
    const option = [...input.options].find(
      (entry) => normalizeText(entry.value) === target || normalizeText(entry.textContent) === target,
    );
    if (!option) return false;
    input.value = option.value;
  } else if (input.isContentEditable || input.getAttribute("role") === "textbox") {
    input.textContent = value;
  } else {
    let prototype;
    if (input.tagName === "TEXTAREA") prototype = view.HTMLTextAreaElement.prototype;
    else if (input.tagName === "INPUT") prototype = view.HTMLInputElement.prototype;

    const setter = prototype && Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
  }

  input.dispatchEvent(new view.Event("input", { bubbles: true }));
  input.dispatchEvent(new view.Event("change", { bubbles: true }));
  input.blur();
  await sleep(100);
  return true;
}

/**
 * Textos aceitos como "Salvar" (o ComprasNet varia entre telas: "Salvar",
 * "Salvar Item", "Gravar", "Confirmar", com/sem ícone dentro).
 */
const TEXTO_BOTAO_SALVAR = /^(salvar|gravar|confirmar|save)(\s+(item|itens|dados|altera[cç][õo]es|e\s+[a-zçãõéíóú]+))?$/;

function ehBotaoSalvar(el) {
  if (!el || !isVisible(el) || el.disabled) return false;
  const texto = normalizeText(
    el.textContent || el.value || el.getAttribute("aria-label") || el.title || "",
  );
  if (!texto) return false;
  return TEXTO_BOTAO_SALVAR.test(texto);
}

async function clickSalvar(itemNumber, allowUnassignedFields) {
  const state = scanPage();
  const key = normalizeItemNumber(itemNumber);
  const group = latestScanState?.itemGroups.get(key);

  // Escopos em ordem de preferência: o contêiner exato do item, o contexto do
  // item um pouco mais acima e — só quando a página não tem itens numerados —
  // o documento inteiro.
  const escopos = [];
  if (group?.container) {
    escopos.push(group.container);
    const contexto = findItemContext(group.container);
    if (contexto?.container && contexto.container !== group.container) escopos.push(contexto.container);
  }
  if (allowUnassignedFields && state.itemCount === 0) escopos.push(...collectDocuments());

  for (const escopo of escopos) {
    const botao = [...escopo.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"], a')]
      .find(ehBotaoSalvar);
    if (botao) {
      botao.click();
      await sleep(600);
      return true;
    }
  }

  // Último recurso: existe exatamente um "Salvar" visível na página (itens em
  // modal ou um formulário por vez) — clica nele em vez de deixar o item sem
  // salvar.
  const globais = [];
  for (const doc of collectDocuments()) {
    globais.push(
      ...[...doc.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"], a')].filter(
        ehBotaoSalvar,
      ),
    );
  }
  if (globais.length === 1) {
    globais[0].click();
    await sleep(600);
    return true;
  }

  return false;
}

// ─── Leitura dos itens da página (extensão → sistema) ────────────────────────
//
// Diferente de scanPage() (que procura CAMPOS para preencher), esta leitura
// extrai os DADOS dos itens já publicados pelo ComprasNet: número, descrição,
// quantidade, unidade e valor estimado. Opcionalmente expande cada item
// ("mostrar detalhes") para pegar a descrição completa.

const PAGE_LABELS = [
  /quantidade\s+solicitada/i,
  /unidade\s+(?:de\s+)?fornecimento/i,
  /valor\s+estimado/i,
  /proposta\s+n[aã]o\s+cadastrada/i,
  /descri[cç][aã]o\s+detalhada/i,
  /termo\s+de\s+aceita[cç][aã]o/i,
  /declara[cç][aã]o/i,
];

/**
 * Texto que é *só* o rótulo de um campo (nada de descrição). Ancorado de
 * propósito: "PEÇA COM MARCA FABRICANTE DEFINIDA" continua sendo descrição.
 */
const ROTULO_DE_CAMPO = new RegExp(
  "^(?:valor\\s+unit[aá]rio(?:\\s*\\(\\s*r\\$\\s*\\))?|marca(?:\\s*\\/\\s*|\\s+)fabricante|" +
    "modelo(?:\\s*\\/\\s*|\\s+)vers[aã]o|quantidade(?:\\s+solicitada)?|unidade(?:\\s+de\\s+fornecimento)?|" +
    "descri[cç][aã]o(?:\\s+detalhada)?|termo\\s+de\\s+aceita[cç][aã]o)\\s*:?\\s*\\*?$",
  "i",
);

/**
 * "Expandir/Mostrar todos os itens": algumas telas do ComprasNet só montam a
 * lista depois desse clique. Só é usado quando a busca normal não achou item
 * nenhum — assim não interfere na leitura item a item.
 */
async function expandirTodos(delay) {
  const candidatos = [];

  for (const doc of collectDocuments()) {
    for (const el of doc.querySelectorAll('button, a, [role="button"], [class*="expand"], [class*="collapse"]')) {
      if (!isVisible(el)) continue;
      const rotulo = `${textoDoBotao(el)} ${pistasDoBotao(el)}`;
      if (!/(expandir|mostrar|abrir|ver)\s+(todos|tudo|todas)/.test(rotulo)) continue;
      if (BOTAO_EXPANDIR_BLOQUEADO.test(rotulo)) continue;
      candidatos.push({ el, pontos: pontuarBotaoExpandir(el) + 20 });
    }
  }

  candidatos.sort((a, b) => b.pontos - a.pontos);
  const botao = candidatos[0]?.el;
  if (!botao) return false;

  try {
    botao.click();
  } catch (_) {
    return false;
  }
  await sleep(delay + 300);
  return true;
}

async function readPageItems({ expandir = true, delay = 400 } = {}) {
  const avisos = [];
  const identificacao = readPageIdentificacao();

  let blocos = findItemBlocks();
  let expandiuTodos = false;

  // A lista pode estar atrás de um "Mostrar todos os itens" — tenta esse clique
  // antes de desistir.
  if (blocos.length === 0) {
    expandiuTodos = await expandirTodos(delay);
    if (expandiuTodos) blocos = findItemBlocks();
  }

  // Última tentativa: itens montados mas escondidos (o conteúdo só aparece
  // depois de abrir cada um) — mantém o comportamento anterior da extensão.
  if (blocos.length === 0) blocos = findItemBlocks({ exigirVisivel: false });

  if (blocos.length === 0) {
    return {
      ok: false,
      error:
        "Não encontrei a lista de itens nesta página. Abra a página de cadastro de propostas do ComprasNet com os itens visíveis e tente novamente.",
      identificacao,
    };
  }

  const itens = [];
  let expandidos = 0;
  abortRequested = false;

  if (expandir) showProgressBar(0, blocos.length);

  for (const [index, bloco] of blocos.entries()) {
    if (abortRequested) {
      avisos.push("Leitura interrompida antes do fim da lista.");
      break;
    }

    const numero = itemNumberFromBlock(bloco) || String(index + 1);

    // A seta "mostrar detalhes" costuma ficar no cabeçalho do item, fora do
    // bloco de detalhes — então a busca usa o escopo do item (que nunca engole
    // outro item) e acontece antes de expandir.
    const escopo = findItemScope(bloco, blocos);

    if (expandir) {
      const abriu = await expandItemBlock(escopo, delay);
      if (abriu) expandidos += 1;
    }

    const dados = extractItemData(escopo, numero);
    if (!dados.descricao) {
      avisos.push(`Item ${numero}: não consegui ler a descrição; confira na página antes de enviar.`);
    }
    itens.push(dados);

    if (expandir) showProgressBar(index + 1, blocos.length);
  }

  if (expandir) removeProgressBar();

  return {
    ok: true,
    url: location.href,
    identificacao,
    itens,
    total: itens.length,
    expandidos,
    expandiuTodos,
    avisos,
  };
}

/** Cabeçalho da página: UASG, número da compra/processo, objeto e data limite. */
function readPageIdentificacao() {
  let texto = "";
  try {
    texto = (document.body?.innerText || document.body?.textContent || "").replace(/\s+/g, " ").trim();
  } catch (_) {
    texto = "";
  }

  const uasg =
    firstMatch(texto, /uasg\s*:?\s*(\d{5,6})\b/i) ||
    firstMatch(texto, /\buasg\b[^\d]{0,30}(\d{5,6})\b/i) ||
    "";

  const numeroCompra =
    firstMatch(texto, /(?:n[ºo°.]?\s*(?:da\s*)?compra|n[uú]mero\s+da\s+compra)\s*:?\s*([0-9][0-9./-]{5,30})/i) ||
    firstMatch(texto, /(?:processo|n[ºo°.]?\s*processo)\s*:?\s*([0-9][0-9./-]{5,30})/i) ||
    firstMatch(texto, /\b(\d{15,20})\b/) ||
    numeroCompraDaUrl();

  const objeto =
    firstMatch(
      texto,
      /objeto\s*:?\s*(.{10,400}?)(?:\s*(?:data\s+limite|uasg|n[ºo°.]?\s*(?:da\s*)?compra|processo)\b|$)/i,
    ) || "";

  const dataLimite =
    firstMatch(texto, /data\s+limite[^:]{0,60}:?\s*(\d{2}\/\d{2}\/\d{4}(?:\s*\d{1,2}:\d{2})?)/i) || "";

  return {
    uasg,
    numeroCompra,
    objeto,
    dataLimite,
    url: location.href,
  };
}

function numeroCompraDaUrl() {
  try {
    const url = new URL(location.href);
    for (const [chave, valor] of url.searchParams.entries()) {
      if (/compra|processo|num|numero/i.test(chave)) {
        const digitos = String(valor).replace(/\D+/g, "");
        if (digitos.length >= 6) return String(valor);
      }
    }
    const doCaminho = url.pathname.match(/\d{10,20}/);
    if (doCaminho) return doCaminho[0];
  } catch (_) {
    // URL inesperada: segue sem número da compra.
  }
  return "";
}

/**
 * Encontra os blocos de item. Um bloco é o menor elemento visível que:
 *   - começa com o número do item;
 *   - contém "Quantidade solicitada";
 *   - contém "Valor estimado" ou um valor em R$.
 * Blocos repetidos (contêineres maiores que envolvem os itens) são descartados.
 */
/**
 * Texto que está de fato aparecendo, ignorando nós escondidos (display:none).
 * É o que evita "achar" um item cujo conteúdo só aparece depois de clicar em
 * "Mostrar todos os itens".
 */
function textoVisivel(el) {
  const partes = [];
  try {
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const pai = node.parentElement;
      if (!pai || !isVisible(pai)) continue;
      partes.push(node.nodeValue);
    }
  } catch (_) {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }
  return partes.join(" ").replace(/\s+/g, " ").trim();
}

function findItemBlocks({ exigirVisivel = true } = {}) {
  const candidatos = [];

  for (const doc of collectDocuments()) {
    const elementos = doc.querySelectorAll('tr, li, section, article, div, [role="row"], [data-item]');

    for (const el of elementos) {
      if (!isVisible(el)) continue;
      const bruto = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!bruto || bruto.length > 3000) continue;
      if (!/quantidade\s+solicitada/i.test(bruto)) continue;
      if (!/valor\s+estimado/i.test(bruto) && !/r\$/i.test(bruto)) continue;

      // Confirma pelo que está VISÍVEL: itens escondidos atrás de um
      // "Mostrar todos os itens" não contam (quem cuida disso é expandirTodos).
      if (exigirVisivel) {
        const visivel = textoVisivel(el);
        if (!visivel || !/quantidade\s+solicitada/i.test(visivel)) continue;
      }

      const numero = itemNumberFromBlock(el);
      if (!numero) continue;

      candidatos.push({ el, numero, profundidade: elementDepth(el), tamanho: bruto.length });
    }
  }

  // Mais profundo (menor contêiner) primeiro; em empate, o texto menor.
  candidatos.sort((a, b) => b.profundidade - a.profundidade || a.tamanho - b.tamanho);

  const escolhidos = [];
  for (const candidato of candidatos) {
    if (escolhidos.some((e) => e.numero === candidato.numero)) continue;
    // Descarta contêineres que englobam um item já escolhido.
    if (escolhidos.some((e) => candidato.el.contains(e.el))) continue;
    escolhidos.push(candidato);
  }

  return escolhidos
    .sort((a, b) => Number(a.numero) - Number(b.numero))
    .map((escolhido) => escolhido.el);
}

function elementDepth(el) {
  let profundidade = 0;
  let node = el;
  while (node && node.parentElement && profundidade < 50) {
    profundidade += 1;
    node = node.parentElement;
  }
  return profundidade;
}

function itemNumberFromBlock(el) {
  const porAtributo = getItemNumberFromAttributes(el);
  if (porAtributo) return porAtributo;

  const bruto = (el.textContent || "").replace(/\s+/g, " ").trim();
  const porTexto = getLeadingItemNumber(bruto);
  if (porTexto) return porTexto;

  // Fallback: "Item 3" em algum lugar do bloco.
  return getExplicitItemNumbers(bruto)[0] || "";
}

function findItemScope(bloco, todosOsBlocos) {
  let node = bloco.parentElement;
  let melhor = bloco;

  for (let nivel = 0; node && nivel < 6; nivel += 1, node = node.parentElement) {
    if (node === node.ownerDocument.body) break;
    // Nunca misturar itens: para antes de englobar o bloco de outro item.
    if (todosOsBlocos.some((outro) => outro !== bloco && node.contains(outro))) break;
    if ((node.textContent || "").length > 4000) break;
    melhor = node;
  }

  return melhor;
}

function extractItemData(bloco, numero) {
  const bruto = textoVisivel(bloco) || (bloco.textContent || "").replace(/\s+/g, " ").trim();

  const quantidade =
    firstMatch(bruto, /quantidade\s+solicitada\s*:?\s*([0-9][0-9.,]*)/i) || "";
  const unidade =
    firstMatch(bruto, /unidade\s+(?:de\s+)?fornecimento\s*:?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ./-]{0,24})/i) || "";
  const valorEstimado =
    firstMatch(bruto, /valor\s+estimado(?:\s*\(\s*unit[aá]rio\s*\))?\s*:?\s*(R\$\s*[0-9][0-9.,]*|[0-9][0-9.,]*)/i) || "";

  const trechos = collectCleanTexts(bloco);
  const resumo = collectCleanTexts(bloco, { ignorarDetalhes: true });
  const atributosResumo = collectAttributeTexts(bloco, { ignorarDetalhes: true });
  const descricao = escolherDescricao(
    resumo.length ? resumo : trechos,
    atributosResumo.length ? atributosResumo : collectAttributeTexts(bloco),
  );
  const descricaoDetalhada = escolherDescricaoDetalhada(bloco, trechos, descricao);

  return {
    numeroItem: numero,
    descricao,
    descricaoDetalhada,
    quantidade,
    unidade,
    valorEstimado,
  };
}

function firstMatch(texto, regex) {
  const match = String(texto || "").match(regex);
  return match ? String(match[1]).trim() : "";
}

/** Contêineres do painel que abre com a "seta" (descrição detalhada). */
const PAINEL_DE_DETALHES = '[class*="detalh"], [class*="detail"], [class*="collapse"], [class*="accordion"]';

function dentroDePainelDeDetalhes(el) {
  try {
    return Boolean(el?.closest?.(PAINEL_DE_DETALHES));
  } catch (_) {
    return false;
  }
}

/**
 * Texto de cada nó do bloco, já sem rótulos, números soltos e ruído de UI.
 * Com `ignorarDetalhes`, pula o painel que abre com a seta — é o que separa a
 * descrição resumida (coluna do item) da descrição detalhada.
 */
function collectCleanTexts(bloco, { ignorarDetalhes = false } = {}) {
  const textos = [];
  const vistos = new Set();

  const adicionar = (valor) => {
    const texto = limparDescricao(valor);
    if (!texto || texto.length < 8) return;
    if (vistos.has(texto)) return;
    vistos.add(texto);
    textos.push(texto);
  };

  try {
    const walker = bloco.ownerDocument.createTreeWalker(bloco, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const pai = node.parentElement;
      if (!pai || !isVisible(pai)) continue;
      if (pai.tagName === "SCRIPT" || pai.tagName === "STYLE") continue;
      if (ignorarDetalhes && dentroDePainelDeDetalhes(pai)) continue;
      adicionar(node.nodeValue);
    }
  } catch (_) {
    // TreeWalker indisponível: usa o texto do bloco inteiro.
    adicionar(bloco.textContent);
  }

  // Títulos/atributos costumam guardar o texto completo que a célula corta.
  for (const el of bloco.querySelectorAll("[title], [aria-label]")) {
    if (!isVisible(el)) continue;
    if (ignorarDetalhes && dentroDePainelDeDetalhes(el)) continue;
    adicionar(el.getAttribute("title"));
    adicionar(el.getAttribute("aria-label"));
  }

  return textos;
}

function collectAttributeTexts(el, { ignorarDetalhes = false } = {}) {
  const textos = [];
  const vistos = new Set();
  for (const alvo of el.querySelectorAll("[title], [aria-label]")) {
    if (!isVisible(alvo)) continue;
    if (ignorarDetalhes && dentroDePainelDeDetalhes(alvo)) continue;
    for (const bruto of [alvo.getAttribute("title"), alvo.getAttribute("aria-label")]) {
      const texto = limparDescricao(bruto);
      if (!texto || texto.length < 8 || vistos.has(texto)) continue;
      vistos.add(texto);
      textos.push(texto);
    }
  }
  return textos;
}

/**
 * Limpa um trecho para uso como DESCRIÇÃO.
 *
 * Importante: não remove números — descrições de licitação costumam trazê-los
 * ("PNEU 175/70 R13", "CABO 2,5MM"). Só descarta valores monetários, frases de
 * situação e o texto do botão de expandir. Trechos sem nenhuma letra (números
 * soltos da tela) são descartados.
 */
function limparDescricao(valor) {
  let texto = String(valor || "").replace(/\s+/g, " ").trim();
  if (!texto) return "";
  if (ROTULO_DE_CAMPO.test(texto)) return "";

  // Rótulos conhecidos ("Quantidade Solicitada: 4") saem, o valor fica.
  for (const regex of PAGE_LABELS) texto = texto.replace(new RegExp(regex.source, "gi"), " ");

  texto = texto
    .replace(/r\$\s*[0-9][0-9.,]*/gi, " ")
    .replace(/proposta\s+n[aã]o\s+cadastrada/gi, " ")
    .replace(/(?:mostrar|ocultar|ver)\s+detalhes/gi, " ")
    .replace(/\bdetalhes?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  texto = texto.replace(/^[\s:;,.(\-–—/|]+|[\s:;,.(\-–—/|]+$/g, "");
  if (!/[A-Za-zÀ-ÿ]/.test(texto)) return "";
  return texto;
}

function escolherDescricao(trechos, atributos = []) {
  const utilizaveis = trechos
    .filter((texto) => /[A-Za-zÀ-ÿ]{3}/.test(texto))
    .filter((texto) => texto.split(" ").length >= 2);

  // O `title` da célula costuma ter a descrição completa que a tela corta com "…".
  const porAtributo = atributos
    .filter((texto) => /[A-Za-zÀ-ÿ]{3}/.test(texto))
    .filter((texto) => texto.split(" ").length >= 2)
    .sort((a, b) => b.length - a.length)[0];
  if (porAtributo) return porAtributo;

  const curtas = utilizaveis.filter((texto) => texto.length <= 400);
  const candidatos = curtas.length ? curtas : utilizaveis;
  if (candidatos.length === 0) return "";
  return candidatos.sort((a, b) => b.length - a.length)[0];
}

function escolherDescricaoDetalhada(bloco, trechos, descricao) {
  const seletores = [
    '[class*="detalh"]',
    '[class*="detail"]',
    '[class*="collapse"]',
    '[class*="accordion"]',
    '[class*="content"]',
  ];

  const candidatos = [];
  for (const el of bloco.querySelectorAll(seletores.join(","))) {
    if (!isVisible(el)) continue;
    for (const texto of collectCleanTexts(el)) candidatos.push(texto);
  }

  const todos = [...candidatos, ...trechos]
    .filter((texto) => texto && texto !== descricao)
    .filter((texto) => texto.length >= 15 && /[A-Za-zÀ-ÿ]{3}/.test(texto))
    .filter((texto) => texto.split(" ").length >= 2);

  if (todos.length === 0) return "";

  const melhor = todos.sort((a, b) => b.length - a.length)[0];
  if (descricao && melhor.length <= descricao.length + 5) return "";
  return melhor.slice(0, 4000);
}

// Botões que nunca são o "mostrar detalhes": o clique errado cai neles quando
// o item tem um botão de Favoritos com ícone de estrela/coração (que parece
// uma seta). Bloquear pelo texto, aria-label, classe e ícones filhos.
const BOTAO_EXPANDIR_BLOQUEADO = /\b(favorit\w*|favourite\w*|curtir|curtida|like|estrela\w*|star|heart|coracao|bookmark|marcador|salvar|save|gravar|enviar|submit|excluir|deletar|remov\w*|editar|alterar|cancelar|voltar|copiar|duplicar\w*|imprimir|print|baixar|download|anexo\w*|attach\w*|compartilh\w*|share)\b/i;
const BOTAO_EXPANDIR_PISTAS = /(detalh|detalhe|expand|mostrar|ocultar|chevron|arrow|angle|caret|seta|toggle|abrir|accordion|collapse|down|baixo|mais|indicator|sinal)/i;
const BOTAO_EXPANDIR_TEXTO = /(detalh|mostrar|ocultar|expandir|ver mais|abrir|mais informa)/i;

function textoDoBotao(el) {
  return normalizeText(
    `${el.textContent || ""} ${el.getAttribute("aria-label") || ""} ${el.title || ""} ${el.value || ""}`,
  );
}

/** Texto, título, classe e classes/alt dos ícones filhos (fonte das pistas). */
function pistasDoBotao(el) {
  const classe = typeof el.className === "string" ? el.className : "";
  const filhos = [...el.querySelectorAll("i, svg, img, span, use")]
    .map((filho) => {
      const classeFilho = typeof filho.className === "string" ? filho.className : "";
      return `${classeFilho} ${filho.getAttribute?.("src") || ""} ${filho.getAttribute?.("alt") || ""} ${
        filho.getAttribute?.("title") || ""
      } ${filho.getAttribute?.("href") || ""}`;
    })
    .join(" ");

  return normalizeText(
    `${el.getAttribute("aria-label") || ""} ${el.title || ""} ${classe} ${el.id || ""} ${
      el.getAttribute("data-testid") || ""
    } ${el.getAttribute("data-toggle") || ""} ${el.getAttribute("data-bs-toggle") || ""} ${filhos}`,
  );
}

/**
 * Pontua um candidato a "mostrar detalhes". Devolve <= 0 para o que nunca deve
 * ser clicado (Favoritos, Salvar...), por mais que pareça uma seta.
 */
function pontuarBotaoExpandir(el) {
  const texto = textoDoBotao(el);
  const pistas = pistasDoBotao(el);
  const rotulo = `${texto} ${pistas}`;

  if (BOTAO_EXPANDIR_BLOQUEADO.test(rotulo)) return -1000;
  if (el.matches?.('input[type="submit"], button[type="submit"], [aria-disabled="true"]')) return -500;

  let pontos = 0;
  if (el.getAttribute("aria-expanded") === "false") pontos += 60;
  const toggle = `${el.getAttribute("data-toggle") || ""} ${el.getAttribute("data-bs-toggle") || ""}`;
  if (/collapse/.test(toggle)) pontos += 45;
  if (BOTAO_EXPANDIR_PISTAS.test(pistas)) pontos += 30;
  if (BOTAO_EXPANDIR_TEXTO.test(texto)) pontos += 25;
  if (el.tagName === "BUTTON") pontos += 6;
  if (!normalizeText(el.textContent || "").trim() && el.querySelector("svg, i, img")) pontos += 15;
  if (el.matches?.('a[href]')) pontos -= 10;

  return pontos;
}

/** Sobe do ícone até o elemento clicável mais próximo (dentro do escopo). */
function elementoClicavel(el, escopo) {
  const clicavel = 'button, a, [role="button"], [onclick], [data-toggle], [data-bs-toggle], label, summary';
  let node = el;
  while (node && node !== escopo) {
    if (node.matches?.(clicavel)) return node;
    node = node.parentElement;
  }
  return el;
}

function findExpandButton(escopo) {
  const seletor = [
    'button[aria-expanded="false"]',
    'a[aria-expanded="false"]',
    "button",
    "a",
    '[role="button"]',
    '[data-toggle="collapse"]',
    '[data-bs-toggle="collapse"]',
    '[class*="chevron"]',
    '[class*="arrow"]',
    '[class*="seta"]',
    '[class*="caret"]',
    '[class*="expand"]',
  ].join(",");

  return (
    [...escopo.querySelectorAll(seletor)]
      .filter((el) => isVisible(el))
      .map((el) => ({ el, pontos: pontuarBotaoExpandir(el) }))
      .filter((candidato) => candidato.pontos > 0)
      .sort((a, b) => b.pontos - a.pontos)[0]?.el || null
  );
}

/** Painéis de detalhes que estão de fato aparecendo dentro do escopo. */
function contarPaineisVisiveis(raiz) {
  return [...raiz.querySelectorAll(PAINEL_DE_DETALHES)].filter(isVisible).length;
}

async function expandItemBlock(escopo, delay) {
  const candidato = findExpandButton(escopo);
  if (!candidato) return false;

  const botao = elementoClicavel(candidato, escopo);
  if (botao.getAttribute("aria-expanded") === "true") return false;

  const tamanhoAntes = (escopo.textContent || "").length;
  const alturaAntes = escopo.getBoundingClientRect?.().height || 0;
  const paineisAntes = contarPaineisVisiveis(escopo);

  try {
    botao.click();
  } catch (_) {
    return false;
  }
  await sleep(delay);

  const tamanhoDepois = (escopo.textContent || "").length;
  const alturaDepois = escopo.getBoundingClientRect?.().height || 0;

  // Três sinais de que abriu: o botão avisou, o conteúdo cresceu ou um painel
  // de detalhes passou a aparecer (o que funciona mesmo com o painel montado
  // escondido, como o site faz).
  return (
    botao.getAttribute("aria-expanded") === "true" ||
    tamanhoDepois > tamanhoAntes + 10 ||
    alturaDepois > alturaAntes + 10 ||
    contarPaineisVisiveis(escopo) > paineisAntes
  );
}

// ─── Visibilidade e utilidades ────────────────────────────────────────────────

function isVisible(el) {
  if (!el || !el.isConnected) return false;
  const doc = el.ownerDocument;
  const view = doc.defaultView || window;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  let node = el;
  while (node && node.nodeType === 1) {
    const style = view.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    if (node === doc.documentElement) break;
    node = node.parentElement;
  }

  try {
    const frame = view.frameElement;
    if (frame && frame.ownerDocument !== doc && !isVisible(frame)) return false;
  } catch (_) {
    return false;
  }

  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Notificações na página ───────────────────────────────────────────────────

function showNotification(message, type = "info") {
  removeNotification();

  const colors = {
    info: "#1351b4",
    success: "#168821",
    warning: "#FFCD07",
    error: "#E52207",
  };
  const textColors = { info: "#fff", success: "#fff", warning: "#222", error: "#fff" };

  const div = document.createElement("div");
  div.id = "__comprasnet_bot_notification__";
  div.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 999999;
    background: ${colors[type] || colors.info};
    color: ${textColors[type] || "#fff"};
    padding: 14px 20px;
    border-radius: 10px;
    font-family: 'Segoe UI', sans-serif;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    max-width: 380px;
    line-height: 1.4;
  `;
  div.textContent = message;
  document.body.appendChild(div);

  if (type === "success" || type === "warning") setTimeout(removeNotification, 5000);
}

function removeNotification() {
  document.getElementById("__comprasnet_bot_notification__")?.remove();
}

function showProgressBar(current, total) {
  removeProgressBar();

  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const barWrap = document.createElement("div");
  barWrap.id = "__comprasnet_bot_progress__";
  barWrap.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 999999;
    background: #1351b4;
    height: 4px;
  `;

  const bar = document.createElement("div");
  bar.style.cssText = `height: 100%; width: ${pct}%; background: #168821; transition: width 0.4s ease;`;
  barWrap.appendChild(bar);
  document.body.appendChild(barWrap);

  const label = document.createElement("div");
  label.id = "__comprasnet_bot_progress_label__";
  label.style.cssText = `
    position: fixed;
    top: 8px;
    right: 20px;
    z-index: 999999;
    background: rgba(19,81,180,0.95);
    color: white;
    padding: 4px 12px;
    border-radius: 20px;
    font-family: 'Segoe UI', sans-serif;
    font-size: 12px;
    font-weight: 600;
  `;
  label.textContent = `🤖 Item ${current}/${total} (${pct}%)`;
  document.body.appendChild(label);
}

function removeProgressBar() {
  document.getElementById("__comprasnet_bot_progress__")?.remove();
  document.getElementById("__comprasnet_bot_progress_label__")?.remove();
}

window.__comprasnet_bot_ready__ = true;
