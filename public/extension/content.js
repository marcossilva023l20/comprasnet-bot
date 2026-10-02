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
  const salvamentos = [];
  const savedItems = [];
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
      if (outcome.salvamento) {
        salvamentos.push(outcome.salvamento);
        // Só considera "salvo" o item cujo Salvar foi realmente clicado.
        if (outcome.salvamento.clicado) savedItems.push(item.item);
      }
    } catch (err) {
      errors.push(`Item ${item.item}: ${err.message}`);
    }

    showProgressBar(filled, items.length);
    await sleep(delayMs);
  }

  removeProgressBar();

  const semSalvar = items.length - savedItems.length;
  const confirmados = salvamentos.filter((s) => s.clicado && s.confirmado).length;
  if (abortRequested) {
    showNotification(`⏹ Parado: ${filled} de ${items.length} itens preenchidos.`, "warning");
  } else if (filled === items.length && confirmados === items.length) {
    showNotification(`✅ ${filled} itens preenchidos e salvos (o site confirmou)!`, "success");
  } else if (filled === items.length && semSalvar === 0) {
    showNotification(`⚠️ ${filled} itens preenchidos e com Salvar clicado, mas o site não confirmou ${items.length - confirmados}. Confira na página.`, "warning");
  } else if (filled === items.length) {
    showNotification(`⚠️ ${filled} itens preenchidos, ${semSalvar} sem Salvar — veja o relatório no popup.`, "warning");
  } else {
    showNotification(`⚠️ ${filled} de ${items.length} itens preenchidos. ${errors.length} erro(s).`, "warning");
  }

  return {
    filled,
    total: items.length,
    errors,
    warnings,
    filledItems,
    salvamentos,
    savedItems,
    aborted: abortRequested,
  };
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

  // Dá tempo para o site validar/computar (valor total, máscara) antes de salvar.
  await sleep(500);
  showNotification(`💾 Item ${itemNumber}: salvando...`, "info");
  const salvamento = await salvarItem(itemNumber, allowUnassignedFields, fields);

  if (!salvamento.clicado) {
    warnings.push(
      `Item ${itemNumber}: os campos foram preenchidos, mas NÃO salvei — ${salvamento.motivo}. Clique em Salvar na página.`,
    );
    showNotification(`⚠️ Item ${itemNumber}: preenchido, mas não salvou — ${salvamento.motivo}`, "warning");
  } else if (!salvamento.confirmado) {
    warnings.push(
      `Item ${itemNumber}: cliquei em "${salvamento.botao}" ${salvamento.tentativas > 1 ? "2 vezes " : ""}e o site não confirmou${salvamento.motivo ? ` (${salvamento.motivo})` : ""} — confira na página antes de seguir.`,
    );
    showNotification(
      `⚠️ Item ${itemNumber}: cliquei em Salvar, mas o site não confirmou — confira a página`,
      "warning",
    );
  } else {
    showNotification(`✅ Item ${itemNumber}: salvo!`, "success");
  }

  return { ok: true, warnings, salvamento };
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

/** Número a partir de um valor digitado/exibido ("R$ 1.234,5000" → 1234.5). */
function valorNumerico(texto) {
  if (texto === null || texto === undefined) return null;
  const limpo = String(texto).replace(/[^\d.,-]/g, "").trim();
  if (!limpo || !/\d/.test(limpo)) return null;

  const ultimo = Math.max(limpo.lastIndexOf(","), limpo.lastIndexOf("."));
  if (ultimo < 0) {
    const inteiro = Number(limpo);
    return Number.isFinite(inteiro) ? inteiro : null;
  }

  const parteInteira = limpo.slice(0, ultimo).replace(/[.,]/g, "");
  const parteFracionaria = limpo.slice(ultimo + 1).replace(/[.,]/g, "");
  const numero = Number(`${parteInteira || "0"}.${parteFracionaria || "0"}`);
  return Number.isFinite(numero) ? numero : null;
}

/** Os dois valores são o mesmo número? (tolerância para arredondamento) */
function mesmoNumero(a, b) {
  if (a === null || b === null) return false;
  return Math.abs(a - b) < 1e-6;
}

/** Valor com N casas no formato brasileiro ("44" → "44,0000"). */
function comCasas(valor, casas) {
  const numero = typeof valor === "number" ? valor : valorNumerico(valor);
  if (numero === null) return String(valor ?? "");
  return numero.toFixed(casas).replace(".", ",");
}

/** O campo continua vazio depois de tentarmos escrever? (máscara recusou) */
function campoVazio(el) {
  return !String(el?.value ?? el?.textContent ?? "").trim();
}

/** Dispara um evento do tipo certo, sem quebrar em navegadores antigos. */
function disparar(el, tipo, view, dados = {}) {
  const ehInput = tipo === "input" || tipo === "beforeinput";
  const Evento = ehInput && typeof view.InputEvent === "function" ? view.InputEvent : view.Event;
  try {
    el.dispatchEvent(new Evento(tipo, { bubbles: true, cancelable: ehInput, ...dados }));
  } catch (_) {
    try {
      el.dispatchEvent(new view.Event(tipo, { bubbles: true }));
    } catch (_) {
      // sem eventos: o valor direto continua valendo
    }
  }
}

function aplicarValor(input, value, view) {
  if (input.isContentEditable || input.getAttribute("role") === "textbox") {
    input.textContent = value;
    return;
  }
  let prototype;
  if (input.tagName === "TEXTAREA") prototype = view.HTMLTextAreaElement?.prototype;
  else if (input.tagName === "INPUT") prototype = view.HTMLInputElement?.prototype;

  const setter = prototype && Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
}

/**
 * Insere texto como se fosse digitação (alguns componentes com máscara só
 * aceitam o valor por esse caminho).
 */
function tentarInsertText(input, value) {
  try {
    input.focus();
    if (typeof input.select === "function") input.select();
    if (typeof input.ownerDocument.execCommand === "function") {
      return input.ownerDocument.execCommand("insertText", false, value);
    }
  } catch (_) {
    // segue sem insertText
  }
  return false;
}

/** Limpa o campo mantendo o foco (máscaras reagem ao evento de apagar). */
function limparCampo(input, view) {
  try {
    input.focus();
    if (typeof input.select === "function") input.select();
  } catch (_) {
    // segue
  }
  const doc = input.ownerDocument;
  if (!input.isContentEditable && typeof doc.execCommand === "function") {
    try {
      if (doc.execCommand("delete", false, null)) return;
    } catch (_) {
      // cai no caminho manual
    }
  }
  if (input.isContentEditable || input.getAttribute("role") === "textbox") {
    input.textContent = "";
  } else {
    aplicarValor(input, "", view);
  }
  disparar(input, "input", view, { data: null, inputType: "deleteContentBackward" });
}

/**
 * Digita o valor caractere por caractere — é o caminho que as máscaras de
 * moeda do portal aceitam (cada dígito reformata o campo). O execCommand
 * insere como se fosse teclado; sem ele, o valor é composto a cada tecla.
 */
async function digitarDeVerdade(input, value, view) {
  limparCampo(input, view);

  const doc = input.ownerDocument;
  const podeInsertText = !input.isContentEditable && typeof doc.execCommand === "function";
  const caracteres = [...String(value)];
  let composto = "";

  for (const ch of caracteres) {
    disparar(input, "keydown", view, { key: ch, char: ch, keyCode: ch.charCodeAt(0) });
    disparar(input, "keypress", view, { key: ch, char: ch, keyCode: ch.charCodeAt(0) });

    let inseriu = false;
    if (podeInsertText) {
      try {
        inseriu = doc.execCommand("insertText", false, ch);
      } catch (_) {
        inseriu = false;
      }
    }
    if (!inseriu) {
      composto = composto ? composto + ch : ch;
      aplicarValor(input, composto, view);
      disparar(input, "input", view, { data: ch, inputType: "insertText" });
    }
    disparar(input, "keyup", view, { key: ch, char: ch });

    // A máscara pode ter reformatado o campo: parte do valor realmente aceito.
    if (inseriu) composto = String(input.value ?? "");
    await sleep(12);
  }

  disparar(input, "change", view, { data: String(input.value ?? "") });
  return !campoVazio(input);
}

/** Uma tentativa completa de escrever o valor no campo. */
async function preencherCampo(input, value, view) {
  // 1º caminho: digitar de verdade (máscaras de moeda só entendem teclado).
  await digitarDeVerdade(input, value, view);

  // 2º: valor direto pelo setter nativo + a sequência de eventos do componente.
  if (value && campoVazio(input)) {
    disparar(input, "keydown", view, { key: "Unidentified" });
    disparar(input, "beforeinput", view, { data: value, inputType: "insertText" });
    aplicarValor(input, value, view);
    disparar(input, "input", view, { data: value, inputType: "insertText" });
    disparar(input, "keyup", view, { key: "Unidentified" });
    disparar(input, "change", view, { data: value });
  }

  // 3º: insertText de uma vez (alguns componentes com máscara só aceitam assim).
  if (value && campoVazio(input)) {
    if (tentarInsertText(input, value)) {
      disparar(input, "input", view, { data: value, inputType: "insertText" });
      disparar(input, "change", view, { data: value });
    }
  }

  // blur: formulários que só validam/commitam o valor ao sair do campo.
  try {
    disparar(input, "blur", view, {});
    disparar(input, "focusout", view, {});
    input.blur();
  } catch (_) {
    // blur é opcional
  }
  await sleep(120);
}

async function setInputValue(input, rawValue) {
  if (!input || !input.isConnected || !isFillable(input)) return false;

  const view = input.ownerDocument.defaultView || window;
  const value = String(rawValue ?? "");
  const espera = input.tagName === "SELECT" ? "" : value;

  try {
    input.focus();
    if (typeof input.select === "function") input.select();
  } catch (_) {
    // Nem todos os componentes oferecem seleção de texto.
  }

  if (input.tagName === "SELECT") {
    const alvo = normalizeText(value);
    const option = [...input.options].find(
      (entrada) => normalizeText(entrada.value) === alvo || normalizeText(entrada.textContent) === alvo,
    );
    if (!option) return false;
    input.value = option.value;
    disparar(input, "input", view, { data: option.value, inputType: "insertText" });
    disparar(input, "change", view, { data: option.value });
    input.blur();
    await sleep(100);
    return true;
  }

  // O portal usa valores com 4 casas ("44,0000"). Se a máscara do campo espera
  // outro número de casas, digitar o valor errado faz o site gravar outra coisa
  // (44,00 vira 0,4400, por exemplo). Por isso conferimos o que ficou no campo e,
  // se o número não bate, tentamos de novo no formato que a máscara aceita.
  const alvo = valorNumerico(value);
  const formatos =
    alvo === null
      ? [value]
      : [value, comCasas(alvo, 4), comCasas(alvo, 2), String(value).replace(/[.,]/g, ""), String(alvo)];
  const tentativas = [...new Set(formatos.filter((t) => t !== ""))];
  if (tentativas.length === 0) tentativas.push(value);

  for (const tentativa of tentativas) {
    await preencherCampo(input, tentativa, view);

    if (alvo !== null) {
      if (mesmoNumero(valorNumerico(input.value), alvo)) return true;
      continue; // a máscara interpretou diferente: tenta o próximo formato
    }

    if (!espera || !campoVazio(input)) return true;
  }

  return false;
}

/**
 * Textos aceitos como "Salvar" (o ComprasNet varia entre telas: "Salvar",
 * "Salvar Item", "Gravar", "Confirmar", com/sem ícone dentro).
 */
/**
 * Textos aceitos como "Salvar" (o portal varia entre telas: "Salvar",
 * "Salvar Item", "Gravar", "Confirmar"). Ficam de fora os que salvam e já abrem
 * outro formulário ("Salvar e adicionar outro"), porque atrapalhariam os
 * próximos itens.
 */
const TEXTO_BOTAO_SALVAR =
  /^(salvar|gravar|confirmar|save)(\s+(item|itens|dados|altera[cç][õo]es|valor|valores|pre[cç]o|proposta|formul[aá]rio))?$/;
const TEXTO_BOTAO_SALVAR_PROIBIDO =
  /(e\s+(adicionar|incluir|criar|nov[oa]s?|pr[oó]xim\w*|continuar|fechar|sair)|adicionar\s+outr|inserir\s+outr)/i;
const PISTAS_BOTAO_SALVAR = /(salvar|save|gravar|confirmar)/i;

/** Elementos clicáveis onde o "Salvar" costuma estar. */
const SELETOR_CLICAVEL = [
  "button",
  'input[type="submit"]',
  'input[type="button"]',
  'input[type="image"]',
  '[role="button"]',
  "a",
  "[onclick]",
  '[class*="salvar" i]',
  '[id*="salvar" i]',
].join(", ");

/** querySelectorAll atravessando shadow roots abertos (web components). */
function consultarProfundo(raiz, seletor) {
  const achados = [];
  const visitados = new Set();
  const visitar = (no) => {
    if (!no?.querySelectorAll || visitados.has(no)) return;
    visitados.add(no);
    for (const el of no.querySelectorAll(seletor)) achados.push(el);
    for (const el of no.querySelectorAll("*")) {
      if (el.shadowRoot) visitar(el.shadowRoot);
    }
  };
  visitar(raiz);
  return achados;
}

function ehElementoClicavel(el) {
  if (!el?.matches) return false;
  if (
    el.matches(
      'button, input[type="submit"], input[type="button"], input[type="image"], a, [role="button"], [onclick]',
    )
  ) {
    return true;
  }
  return typeof el.tabIndex === "number" && el.tabIndex >= 0;
}

/**
 * Pontua um candidato a botão Salvar. Devolve <= 0 para o que não serve.
 * Texto exato vale mais; id/classe/aria-label com "salvar" também identificam
 * (o botão pode ser só um ícone).
 */
function pontuarBotaoSalvar(el) {
  if (!el || !isVisible(el)) return -1;

  const texto = normalizeText(el.textContent || el.value || "");
  const atributos = normalizeText(
    `${el.getAttribute("aria-label") || ""} ${el.title || ""} ${el.id || ""} ${
      typeof el.className === "string" ? el.className : ""
    } ${el.getAttribute("data-testid") || ""} ${el.getAttribute("name") || ""}`,
  );

  if (TEXTO_BOTAO_SALVAR_PROIBIDO.test(texto)) return -1;

  let pontos = 0;
  if (TEXTO_BOTAO_SALVAR.test(texto)) pontos += 100;
  else if (PISTAS_BOTAO_SALVAR.test(atributos) && (ehElementoClicavel(el) || el.matches(SELETOR_CLICAVEL))) pontos += 60;
  else if (el.matches('[class*="salvar" i], [id*="salvar" i]') && ehElementoClicavel(el)) pontos += 40;

  if (pontos === 0) return -1;
  if (!ehElementoClicavel(el)) pontos -= 20;
  if (el.tagName === "BUTTON") pontos += 8;
  if (el.matches('input[type="submit"]')) pontos += 8;
  if (el.getAttribute("type") === "submit") pontos += 4;
  if (el.disabled) pontos -= 25; // pode habilitar depois — ainda é o nosso botão

  return pontos;
}

function encontrarBotaoSalvar(escopo) {
  const candidatos = consultarProfundo(escopo, SELETOR_CLICAVEL)
    .map((el) => ({ el, pontos: pontuarBotaoSalvar(el) }))
    .filter((candidato) => candidato.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos);

  return candidatos[0]?.el || null;
}

/** Texto do botão para relatar ao usuário ("Salvar", "Gravar item"...). */
function descreverBotao(el) {
  const texto = (el?.textContent || el?.value || el?.getAttribute?.("aria-label") || "").replace(/\s+/g, " ").trim();
  if (texto) return texto.slice(0, 40);
  return normalizeText(typeof el?.className === "string" ? el.className : "") || "botão sem texto";
}

/** Um botão desabilitado pode habilitar quando o formulário fica válido. */
async function esperarHabilitar(botao, tempoMs = 2500) {
  const limite = Date.now() + tempoMs;
  while (Date.now() < limite) {
    if (!botao.isConnected) return false;
    if (!botao.disabled && botao.getAttribute("aria-disabled") !== "true") return true;
    await sleep(150);
  }
  return !botao.disabled;
}

/**
 * Clique "de verdade": além do click(), dispara a sequência de mouse que
 * alguns componentes escutam, e usa requestSubmit() quando o botão é um submit
 * dentro de um form.
 */
function clicarDeVerdade(el) {
  const view = el.ownerDocument?.defaultView || window;
  const opcoes = { bubbles: true, cancelable: true, view, detail: 1 };
  try {
    el.scrollIntoView?.({ block: "center" });
  } catch (_) {
    // jsdom e páginas sem layout não implementam scrollIntoView
  }
  try {
    el.focus?.({ preventScroll: true });
  } catch (_) {
    // foco é opcional
  }
  for (const tipo of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
    try {
      const Evento = tipo.startsWith("pointer") ? view.PointerEvent : view.MouseEvent;
      el.dispatchEvent(new (Evento || view.MouseEvent)(tipo, opcoes));
    } catch (_) {
      // segue para o click()
    }
  }
  // Um clique normal já submete o formulário no navegador; o requestSubmit abaixo
  // é só rede de segurança (e nunca pode rodar junto, senão salva duas vezes).
  const form = el.form || el.closest?.("form");
  let submeteu = false;
  const marcarSubmit = () => {
    submeteu = true;
  };
  if (form) form.addEventListener("submit", marcarSubmit, true);

  try {
    el.click();
  } catch (_) {
    if (form) form.removeEventListener("submit", marcarSubmit, true);
    return false;
  }

  if (form) form.removeEventListener("submit", marcarSubmit, true);

  const tipo = (el.tagName === "INPUT" ? el.type : el.getAttribute?.("type") || "submit").toLowerCase();
  if (form && !submeteu && typeof form.requestSubmit === "function" && (tipo === "submit" || tipo === "image")) {
    try {
      form.requestSubmit(el);
    } catch (_) {
      // sem problema: o click() já é o caminho normal
    }
  }
  return true;
}

/** Mensagens visíveis de sucesso/erro dentro do escopo (toasts, alerts). */
const SELETOR_DE_AVISOS =
  '[role="alert"], [role="status"], [class*="alert" i], [class*="toast" i], [class*="mensagem" i], [class*="aviso" i], [class*="erro" i], [class*="error" i], [class*="sucesso" i], [class*="success" i]';

/** Coleta os elementos que podem carregar um aviso do site (toast, alerta…). */
function avisosDaPagina(escopos) {
  const vistos = new Set();
  const avisos = [];
  for (const escopo of escopos) {
    if (!escopo) continue;
    for (const el of consultarProfundo(escopo, SELETOR_DE_AVISOS)) {
      if (vistos.has(el)) continue;
      vistos.add(el);
      // As nossas próprias notificações/progresso não são resposta do site.
      if (/__comprasnet_bot/.test(String(el.id || "") + " " + String(el.className || ""))) continue;
      const texto = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!texto || texto.length > 200) continue;
      avisos.push({ el, texto });
      if (avisos.length >= 12) break;
    }
  }
  return avisos;
}

/**
 * Estado de um aviso: além do texto, se ele está escondido e um "sinal" que muda
 * quando o site troca de classe/estado. O aviso pode já existir escondido e só
 * aparecer depois do clique — é isso que detecta o salvamento.
 */
function estadoDoAviso(aviso) {
  const el = aviso.el;
  const inline = el.style?.display || "";
  let computado = "";
  try {
    computado = (el.ownerDocument?.defaultView || window).getComputedStyle(el).display || "";
  } catch (_) {
    computado = "";
  }
  const ocultoPorAtributo = el.hidden === true || el.getAttribute("aria-hidden") === "true" || inline === "none";
  // Em shadow DOM (e no jsdom) o estilo computado pode ficar desatualizado: se o
  // próprio elemento declara um display diferente de "none", confie na declaração.
  const oculto = ocultoPorAtributo || (computado === "none" && !inline);
  return {
    texto: aviso.texto.slice(0, 160),
    oculto,
    sinal: `${inline}|${el.getAttribute("class") || ""}`,
  };
}

/**
 * A mensagem que o site mostrou indica que gravou? (toast de sucesso)
 * Mensagens de erro/validação nunca contam como confirmação.
 */
function pareceConfirmacao(mensagens) {
  for (const mensagem of mensagens || []) {
    if (/(erro|error|inv[aá]lid|obrigat[óo]ri|falh|incorret|rejeit|n[ãa]o\s+(foi|p[oô]de|conseguiu))/i.test(mensagem)) continue;
    if (/(salv|cadastrad|gravad|sucesso|êxito|exito|atualizad|conclu[íi]d)/i.test(mensagem)) return mensagem;
  }
  return "";
}

/** Textos dos avisos que o usuário está vendo agora (para o relatório). */
function mensagensDeStatus(escopo) {
  const mensagens = [];
  for (const aviso of avisosDaPagina([escopo])) {
    if (estadoDoAviso(aviso).oculto) continue;
    if (!mensagens.includes(aviso.texto)) mensagens.push(aviso.texto);
    if (mensagens.length >= 4) break;
  }
  return mensagens;
}

/**
 * Escopos observados para saber se o site reagiu ao clique: o item e a página
 * inteira (a confirmação costuma aparecer num toast no topo, às vezes dentro de
 * um shadow root — por isso não basta olhar o item).
 */
function escoposDeVerificacao(escopos, botao) {
  const lista = [];
  const adicionar = (el) => {
    if (el && !lista.includes(el)) lista.push(el);
  };
  for (const escopo of escopos) {
    if (escopo?.contains?.(botao)) adicionar(escopo);
  }
  for (const doc of collectDocuments()) adicionar(doc.body || doc.documentElement);
  return lista;
}

/**
 * Escopos que formam o painel do item (sem o <body>, que recebe as nossas
 * notificações e mudaria de texto o tempo todo).
 */
function escoposDoPainel(escopos, botao) {
  return escopos.filter(
    (escopo) => escopo?.contains?.(botao) && escopo !== escopo.ownerDocument?.body && escopo !== escopo.ownerDocument?.documentElement,
  );
}

function assinaturaDeSalvamento(escopos, botao) {
  return JSON.stringify({
    // Lista COM repetição: dois itens salvos geram o mesmo aviso duas vezes.
    avisos: avisosDaPagina(escopos).map(estadoDoAviso),
    // O painel pode confirmar sem toast: "Proposta cadastrada", valor total, etc.
    painel: escoposDoPainel(escopos, botao).map((escopo) => (escopo.textContent || "").replace(/\s+/g, " ").trim().length),
    botaoVisivel: Boolean(botao?.isConnected && isVisible(botao)),
    botaoDesabilitado: Boolean(botao?.disabled),
    itensDesmontados: escopos.filter((escopo) => escopo?.isConnected === false).length,
  });
}

/**
 * Salva o item: encontra o botão (no item, no contexto do item, num ancestral
 * ou — se for o único — na página), espera habilitar, clica e verifica se o
 * site reagiu. Devolve um relatório para o popup.
 */
async function salvarItem(itemNumber, allowUnassignedFields, campos) {
  const estado = scanPage();
  const chave = normalizeItemNumber(itemNumber);
  const grupo = latestScanState?.itemGroups.get(chave);

  // ── Escopos, do mais específico para o mais amplo ────────────────────────
  const escopos = [];
  const adicionar = (el) => {
    if (el && !escopos.includes(el)) escopos.push(el);
  };

  adicionar(grupo?.container);
  if (grupo?.container) {
    // Sobe alguns níveis: o botão costuma ficar no rodapé do painel do item,
    // fora do contêiner que guarda os campos.
    let node = grupo.container.parentElement;
    for (let nivel = 0; node && nivel < 4; nivel += 1, node = node.parentElement) {
      if (node === node.ownerDocument?.body) break;
      if ((node.textContent || "").length > 6000) break;
      adicionar(node);
    }
    const contexto = findItemContext(grupo.container);
    adicionar(contexto?.container);
  }
  if (allowUnassignedFields && estado.itemCount === 0) escopos.push(...collectDocuments());

  const relatorio = { item: itemNumber, encontrado: false, clicado: false, confirmado: false, botao: "", motivo: "" };

  let botao = null;
  for (const escopo of escopos) {
    botao = encontrarBotaoSalvar(escopo);
    if (botao) break;
  }

  // Último recurso: um único "Salvar" visível em cada documento da página.
  if (!botao) {
    const globais = [];
    for (const doc of collectDocuments()) globais.push(...consultarProfundo(doc, SELETOR_CLICAVEL).filter((el) => pontuarBotaoSalvar(el) > 0));
    const unicos = [...new Set(globais)];
    if (unicos.length === 1) botao = unicos[0];
    else if (unicos.length > 1) {
      // Vários itens abertos: pega o que estiver mais perto do item pelo DOM.
      const referencia = grupo?.container;
      if (referencia) {
        let melhor = null;
        let melhorDistancia = Infinity;
        for (const candidato of unicos) {
          let node = candidato;
          let distancia = 0;
          while (node && node !== referencia && distancia < 40) {
            node = node.parentElement;
            distancia += 1;
          }
          if (node === referencia && distancia < melhorDistancia) {
            melhor = candidato;
            melhorDistancia = distancia;
          }
        }
        botao = melhor;
      }
    }
  }

  if (!botao) {
    relatorio.motivo = "não encontrei um botão Salvar nesta página";
    return relatorio;
  }

  relatorio.encontrado = true;
  relatorio.botao = descreverBotao(botao);

  if (botao.disabled || botao.getAttribute("aria-disabled") === "true") {
    const habilitou = await esperarHabilitar(botao);
    if (!habilitou) {
      relatorio.motivo = `o botão "${relatorio.botao}" está desabilitado — falta algum campo obrigatório na tela`;
      return relatorio;
    }
  }

  const ondeObservar = escoposDeVerificacao(escopos, botao);
  const antes = assinaturaDeSalvamento(ondeObservar, botao);
  relatorio.botaoPistas = resumoDoBotao(botao);

  const coletarMensagens = () => {
    const mensagens = [];
    for (const escopo of ondeObservar) {
      for (const mensagem of mensagensDeStatus(escopo)) {
        if (!mensagens.includes(mensagem)) mensagens.push(mensagem);
      }
    }
    return mensagens;
  };

  let confirmado = false;
  let tentativas = 0;
  let mensagens = [];

  // 1ª tentativa normal; se o site não der nenhum sinal, tenta mais uma vez
  // (o primeiro clique pode cair num formulário que ainda não estava pronto).
  for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
    if (!clicarDeVerdade(botao)) {
      relatorio.motivo = `não consegui clicar em "${relatorio.botao}"`;
      return relatorio;
    }
    tentativas = tentativa;
    relatorio.clicado = true;

    const limite = Date.now() + (tentativa === 1 ? 3000 : 2500);
    while (Date.now() < limite) {
      await sleep(250);
      if (grupo?.container && !grupo.container.isConnected) {
        confirmado = true; // a tela foi remontada (item salvo e recarregado)
        break;
      }
      if (assinaturaDeSalvamento(ondeObservar, botao) !== antes) {
        confirmado = true;
        break;
      }
    }

    mensagens = coletarMensagens();
    if (confirmado) break;
    if (pareceConfirmacao(mensagens)) {
      confirmado = true;
      break;
    }

    // Janela de confirmação ("Salvar" → "Confirmar")?
    const modal = await responderModalDeConfirmacao();
    if (modal) {
      relatorio.modal = modal;
      if (modal.clicado) {
        confirmado = true;
        relatorio.confirmado = true;
        relatorio.mensagemSucesso = modal.texto || "confirmação na janela do site";
      }
      // Com uma janela aberta (mesmo sem botão de confirmar), insistir não ajuda.
      if (modal.texto || modal.clicado) break;
    }

    const aindaDisponivel =
      botao.isConnected && !botao.disabled && botao.getAttribute("aria-disabled") !== "true";
    if (!aindaDisponivel) break;
    await sleep(700);
  }

  // O que a página realmente tem nos campos agora (máscara pode ter remontado).
  if (campos) {
    relatorio.valores = {};
    for (const [chave, input] of campos) {
      relatorio.valores[chave] = String(input?.value ?? input?.textContent ?? "").slice(0, 40);
    }
  }

  relatorio.tentativas = tentativas;
  relatorio.confirmado = confirmado;
  relatorio.mensagens = mensagens;
  relatorio.mensagemSucesso = pareceConfirmacao(mensagens);

  if (!confirmado && mensagens.length) {
    relatorio.motivo = `o site mostrou: "${mensagens[0]}"`;
  } else if (!confirmado) {
    relatorio.motivo = "cliquei no Salvar 2× e o site não deu nenhum sinal de confirmação";
    relatorio.botaoHtml = (botao.outerHTML || "").replace(/\s+/g, " ").slice(0, 240);
  }

  // Sem confirmação: guarda pistas para o usuário (e para o suporte) entenderem.
  if (!confirmado) {
    try {
      const candidatos = [];
      for (const doc of collectDocuments()) candidatos.push(...consultarProfundo(doc, SELETOR_CLICAVEL));
      relatorio.diagnostico = {
        candidatosNaPagina: new Set(candidatos.filter((el) => pontuarBotaoSalvar(el) > 0)).size,
        camposDoItem: camposVisiveisDoItem(grupo),
      };
    } catch (_) {
      relatorio.diagnostico = {};
    }
  }

  return relatorio;
}

const SELETOR_DE_MODAL = [
  '[role="dialog"]',
  '[aria-modal="true"]',
  "dialog[open]",
  ".br-modal",
  ".modal.show",
  ".modal[style*=\"display: block\"]",
  ".modal-dialog",
  ".swal2-popup",
  ".p-dialog",
  ".mat-mdc-dialog-container",
].join(", ");

const TEXTO_BOTAO_CONFIRMAR = /^(salvar|gravar|confirmar|sim|ok|enviar|prosseguir|continuar|cadastrar)\s*!?$/i;

/** Está visível e não é fruto de um display "atualizado" só no shadow DOM? */
function visivelDeVerdade(el) {
  if (!el || !el.isConnected) return false;
  const inline = el.style?.display || "";
  if (inline === "none") return false;
  try {
    const view = el.ownerDocument?.defaultView || window;
    const estilo = view.getComputedStyle(el);
    if (estilo.display === "none" || estilo.visibility === "hidden") return false;
    if (!inline && Number.parseFloat(estilo.opacity || "1") === 0) return false;
  } catch (_) {
    // sem getComputedStyle: confia no inline
  }
  return true;
}

/**
 * O site pode pedir confirmação depois do Salvar (modal "Deseja salvar?").
 * Se houver um modal visível, registra o texto e clica no botão de confirmar
 * (nunca em "cancelar", "voltar", "fechar" ou "não").
 */
async function responderModalDeConfirmacao() {
  for (let rodada = 0; rodada < 2; rodada += 1) {
    let modal = null;
    for (const doc of collectDocuments()) {
      const achados = consultarProfundo(doc, SELETOR_DE_MODAL).filter(visivelDeVerdade);
      const visivel = achados.find((el) => normalizeText(el.textContent || "").length > 0);
      if (visivel) {
        modal = visivel;
        break;
      }
    }
    if (!modal) return rodada === 0 ? null : { texto: "", clicado: false };

    const texto = normalizeText(modal.textContent || "").slice(0, 160);
    const botoes = consultarProfundo(modal, "button, input[type='submit'], input[type='button'], [role='button'], a")
      .filter((el) => visivelDeVerdade(el) && !el.disabled)
      .filter((el) => {
        const rotulo = normalizeText(`${el.textContent || ""} ${el.value || ""} ${el.getAttribute("aria-label") || ""}`);
        return TEXTO_BOTAO_CONFIRMAR.test(rotulo);
      });

    if (botoes.length === 0) return { texto, clicado: false };

    const alvo = botoes[0];
    const rotulo = normalizeText(alvo.textContent || alvo.value || "");
    if (!clicarDeVerdade(alvo)) return { texto, clicado: false, botao: rotulo };
    await sleep(900);
    return { texto, clicado: true, botao: rotulo };
  }
  return null;
}

/** Resumo do botão escolhido (id/classe/texto/ícone) para o relatório do popup. */
function resumoDoBotao(el) {
  if (!el) return "";
  const partes = [];
  if (el.id) partes.push(`id="${el.id}"`);
  const classe = normalizeText(typeof el.className === "string" ? el.className : "");
  if (classe) partes.push(`class="${classe}"`);
  const texto = normalizeText(el.textContent || "");
  if (texto) partes.push(`texto="${texto.slice(0, 30)}"`);
  for (const atributo of ["title", "aria-label", "name", "type"]) {
    const valor = el.getAttribute?.(atributo);
    if (valor) partes.push(`${atributo}="${normalizeText(valor).slice(0, 30)}"`);
  }
  const icones = normalizeText(
    [...(el.querySelectorAll?.("i, svg, img, use") || [])]
      .map((filho) => {
        const classeFilho = typeof filho.className === "string" ? filho.className : "";
        return `${classeFilho} ${filho.getAttribute?.("src") || filho.getAttribute?.("href") || ""} ${
          filho.getAttribute?.("alt") || filho.getAttribute?.("title") || ""
        }`;
      })
      .join(" "),
  );
  if (icones) partes.push(`ícone="${icones.slice(0, 40)}"`);
  return partes.join(" · ") || el.tagName.toLowerCase();
}

/** Quantos campos preenchíveis e ainda vazios o painel do item tem. */
function camposVisiveisDoItem(grupo) {
  if (!grupo?.container) return null;
  const campos = [...grupo.container.querySelectorAll("input, textarea, select")];
  const visiveis = campos.filter((el) => isFillable(el) && isVisible(el));
  return {
    total: visiveis.length,
    vazios: visiveis.filter((el) => campoVazio(el)).length,
  };
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
  "^(?:valor\\s+unit[aá]rio(?:\\s*\\(\\s*r\\$\\s*\\))?|valor\\s+total(?:\\s*\\(\\s*r\\$\\s*\\))?|" +
    "valor\\s+estimado(?:\\s*\\(\\s*unit[aá]rio\\s*\\))?|marca(?:\\s*\\/\\s*|\\s+)fabricante|" +
    "modelo(?:\\s*\\/\\s*|\\s+)vers[aã]o|quantidade(?:\\s+(?:solicitada|ofertada|total))?|" +
    "unidade(?:\\s+(?:de\\s+)?(?:fornecimento|medida))?|descri[cç][aã]o(?:\\s+detalhada)?|" +
    "termo\\s+de\\s+aceita[cç][aã]o|proposta\\s+n[aã]o\\s+cadastrada)\\s*:?\\s*\\*?$",
  "i",
);

/**
 * Textos que são só rótulo de controle da tela (o `aria-label` do botão de
 * coração, por exemplo, era lido como descrição do item).
 */
const TEXTO_DE_UI =
  /^(?:(?:adicionar|remover|incluir|excluir|retirar)\s+(?:aos?|dos?|de)\s+(?:favoritos?|carrinho|lista)|favoritos?|(?:mostrar|ocultar|ver)\s+detalhes(?:\s+(?:do|de|da)\s+(?:item|itens))?)\.?$/i;

/** Controles cujo texto/atributo é rótulo de interface, não conteúdo. */
const CONTROLE_DE_UI =
  'button, input, select, textarea, label, summary, svg, i, use, img, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="tab"], a[href]';

function ehRotuloDeUI(el) {
  let controle;
  try {
    controle = el?.closest?.(CONTROLE_DE_UI) || null;
  } catch (_) {
    return false;
  }
  if (!controle) return false;

  // Um link/linha que engloba o item inteiro (texto longo) pode conter a
  // descrição — nesse caso o texto continua valendo.
  if (controle.matches('a[href], [role="button"], [role="link"]')) {
    const texto = (controle.textContent || "").replace(/\s+/g, " ").trim();
    if (texto.length >= 60) return false;
  }
  return true;
}

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

/**
 * Valor de um campo publicado pelo portal: procura o rótulo no DOM e lê o que
 * vem logo depois dele (no próprio elemento, no irmão seguinte ou no pai).
 * O texto corrido do bloco é o último recurso — o portal separa rótulo e valor
 * em contêineres diferentes, e aí a busca por regex no texto falhava.
 */
function valorDoCampo(bloco, regexRotulo, regexValor) {
  const completo = new RegExp(`${regexRotulo.source}\\s*:?\\s*(${regexValor.source})`, "i");

  const rotulos = [];
  for (const el of bloco.querySelectorAll("*")) {
    const texto = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!texto || texto.length > 80) continue;
    if (!regexRotulo.test(texto)) continue;
    if (ehRotuloDeUI(el)) continue;
    rotulos.push(el);
  }
  rotulos.sort((a, b) => elementDepth(b) - elementDepth(a));

  for (const el of rotulos) {
    for (const vizinho of [el, el.nextElementSibling, el.parentElement]) {
      if (!vizinho) continue;
      const encontrado = textoVisivel(vizinho).match(completo);
      if (encontrado) return encontrado[1].trim();
    }
  }

  const texto = textoVisivel(bloco) || (bloco.textContent || "").replace(/\s+/g, " ").trim();
  const encontrado = texto.match(completo);
  return encontrado ? encontrado[1].trim() : "";
}

function extractItemData(bloco, numero) {
  const quantidade =
    valorDoCampo(bloco, /quantidade\s+(?:solicitada|ofertada)/i, /[0-9][0-9.,]*/) ||
    valorDoCampo(bloco, /quantidade/i, /[0-9][0-9.,]*/);
  const unidade =
    valorDoCampo(bloco, /unidade\s+(?:de\\s+)?fornecimento/i, /[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ./-]{0,24}/) ||
    valorDoCampo(bloco, /unidade\s+(?:de\\s+)?medida/i, /[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ./-]{0,24}/);
  const valorEstimado = valorDoCampo(
    bloco,
    /valor\s+estimado(?:\s*\(\s*unit[aá]rio\s*\))?/i,
    /(?:R\$\s*)?[0-9][0-9.,]*/,
  );

  const trechos = collectCleanTexts(bloco);
  const resumo = collectCleanTexts(bloco, { ignorarDetalhes: true });
  const atributosResumo = collectAttributeTexts(bloco, { ignorarDetalhes: true });
  const descricao =
    descricaoDoCabecalho(bloco, numero) ||
    escolherDescricao(
      resumo.length ? resumo : trechos,
      atributosResumo.length ? atributosResumo : collectAttributeTexts(bloco),
      numero,
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
      // Rótulo de botão/ícone ("Adicionar aos favoritos") não é descrição.
      if (ehRotuloDeUI(pai)) continue;
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
    if (ehRotuloDeUI(el)) continue;
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
    if (ehRotuloDeUI(alvo)) continue;
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
  if (TEXTO_DE_UI.test(texto)) return "";

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

/** Corta o texto no primeiro rótulo conhecido ("FONE OUVIDO Quantidade..." → "FONE OUVIDO"). */
function textoAntesDosRotulos(texto) {
  let corte = texto.length;
  for (const regex of PAGE_LABELS) {
    const encontrado = new RegExp(regex.source, "i").exec(texto);
    if (encontrado && encontrado.index < corte) corte = encontrado.index;
  }
  return texto.slice(0, corte);
}

/**
 * Descrição do cabeçalho: o portal mostra o número do item numa célula e a
 * descrição na célula seguinte ("1" | "FONE OUVIDO"). Lê pelo DOM, então
 * funciona mesmo quando o texto corrido junta tudo.
 */
function descricaoDoCabecalho(bloco, numero) {
  const alvo = String(numero || "").trim();
  if (!/^\d{1,6}$/.test(alvo)) return "";

  const soNumero = new RegExp(`^\\s*(?:item\\s*)?${alvo}\\s*[).:\\-–—]?\\s*$`, "i");
  const numeros = [...bloco.querySelectorAll("*")].filter((el) => {
    const texto = (el.textContent || "").replace(/\s+/g, " ").trim();
    return texto.length <= 12 && soNumero.test(texto);
  });
  // O nó mais fundo é o próprio número; os ancestrais também "contêm só o número".
  numeros.sort((a, b) => elementDepth(b) - elementDepth(a));

  for (const el of numeros) {
    let irmao = el.nextElementSibling || el.parentElement?.nextElementSibling || null;
    for (let pulos = 0; irmao && pulos < 3; pulos += 1, irmao = irmao.nextElementSibling) {
      if (ehRotuloDeUI(irmao)) continue;
      const texto = limparDescricao(textoAntesDosRotulos(textoVisivel(irmao)));
      if (!texto || texto.length < 3 || texto.length > 400) continue;
      if (/^\d+(?:[.,]\d+)?$/.test(texto)) continue;
      return texto;
    }
  }
  return "";
}

function escolherDescricao(trechos, atributos = [], numero = "") {
  // 1) Linha do item dentro de um único texto: "1 FONE OUVIDO".
  const alvo = String(numero || "").trim();
  if (/^\d{1,6}$/.test(alvo)) {
    const daLinha = trechos
      .map((texto) => texto.match(new RegExp(`^(?:item\\s*)?${alvo}\\s*[).:\\-–—|]*\\s+(\\S.*)$`, "i")))
      .filter(Boolean)
      .map((encontrado) => limparDescricao(textoAntesDosRotulos(encontrado[1].trim())))
      .filter((texto) => texto.length >= 3 && /[A-Za-zÀ-ÿ]{3}/.test(texto))
      .sort((a, b) => b.length - a.length)[0];
    if (daLinha) return daLinha;
  }

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
  // (mantida para achar botões por ícone; o diagnóstico usa resumoDoBotao)
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
