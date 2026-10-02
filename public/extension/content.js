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
  const selectors = [
    'button[aria-expanded="false"]',
    'a[aria-expanded="false"]',
    'button[data-toggle="collapse"]',
    'button[data-bs-toggle="collapse"]',
    'a[data-toggle="collapse"]',
    '[class*="accordion"] button',
    '[class*="collapse-header"]',
    '[class*="item-header"]',
  ];
  const seen = new Set();

  for (const doc of collectDocuments()) {
    for (const element of doc.querySelectorAll(selectors.join(","))) {
      if (seen.has(element) || !isVisible(element)) continue;
      seen.add(element);

      const state = element.getAttribute("aria-expanded");
      if (state === "true") continue;

      const directText = `${element.textContent || ""} ${element.getAttribute("aria-label") || ""}`;
      const directNumbers = getExplicitItemNumbers(directText);
      const context = findItemContext(element);
      const matchesItem = directNumbers.includes(target) || context?.number === target;
      if (!matchesItem) continue;

      element.click();
      await sleep(400);
      return true;
    }
  }

  return false;
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

async function clickSalvar(itemNumber, allowUnassignedFields) {
  const state = scanPage();
  const key = normalizeItemNumber(itemNumber);
  const group = latestScanState?.itemGroups.get(key);
  const candidates = [];

  if (group?.container) {
    candidates.push(...group.container.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]'));
  } else if (allowUnassignedFields && state.itemCount === 0) {
    for (const doc of collectDocuments()) {
      candidates.push(...doc.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]'));
    }
  }

  const button = candidates.find((candidate) => {
    if (!isVisible(candidate) || candidate.disabled) return false;
    const text = normalizeText(candidate.textContent || candidate.value || candidate.getAttribute("aria-label"));
    return /^(salvar|salvar item|save|save item|gravar|gravar item|confirmar|confirmar item)$/.test(text);
  });

  if (!button) return false;
  button.click();
  await sleep(600);
  return true;
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
