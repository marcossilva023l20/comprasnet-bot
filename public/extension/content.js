/**
 * ComprasNet Preenchedor de Propostas — Content Script
 * Analisa os campos visíveis da página e preenche apenas os campos identificados.
 */

let abortRequested = false;
let latestScanState = null;
let botPausado = false;

const FIELD_LABELS = {
  valorUnitario: "valor unitário",
  marcaFabricante: "marca/fabricante",
  modeloVersao: "modelo/versão",
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "stop") {
    abortRequested = true;
    botPausado = false;
    atualizarPainel();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === "pause") {
    botPausado = true;
    atualizarPainel();
    registrarNoPainel("⏸ Bot pausado — os itens seguintes esperam você mandar continuar.");
    sendResponse({ ok: true, pausado: true });
    return true;
  }

  if (msg.action === "resume") {
    botPausado = false;
    atualizarPainel();
    registrarNoPainel("▶ Bot retomado.");
    sendResponse({ ok: true, pausado: false });
    return true;
  }

  if (msg.action === "status" || msg.action === "ping") {
    sendResponse({
      ok: true,
      pausado: botPausado,
      rodando: Boolean(rodandoAgora),
      painel: Boolean(document.getElementById(PAINEL_ID)),
      url: location.href,
    });
    return true;
  }

  if (msg.action === "painel_mostrar") {
    mostrarPainel();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === "painel_esconder") {
    removerPainel();
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
    fillItems(Array.isArray(msg.items) ? msg.items : [], Number(msg.delay) || DELAY_PADRAO_MS)
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

/** Ordem de preenchimento: item 1, 2, 3, ... 10, 11 (nunca fora de ordem). */
function compararPorItem(a, b) {
  const na = Number(normalizeItemNumber(a?.item));
  const nb = Number(normalizeItemNumber(b?.item));
  const valorA = Number.isFinite(na) && na > 0 ? na : Number.MAX_SAFE_INTEGER;
  const valorB = Number.isFinite(nb) && nb > 0 ? nb : Number.MAX_SAFE_INTEGER;
  return valorA - valorB;
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
  definirRitmo(delayMs);

  let filled = 0;
  const errors = [];
  const warnings = [];
  const filledItems = [];
  const salvamentos = [];
  const savedItems = [];
  abortRequested = false;
  diagnosticoDeCampos.length = 0;

  if (items.length === 0) {
    return { filled, total: 0, errors: ["Nenhum item foi enviado para preencher."], warnings, filledItems };
  }

  showNotification(`🤖 Lendo a página e preenchendo ${items.length} item(ns)...`, "info");

  // Preenche SEMPRE na ordem do Item: 1, 2, 3, 4... É assim que o portal
  // numera os itens na página — e é essa a ordem que o usuário confere.
  const fila = [...items].sort(compararPorItem);

  rodandoAgora = true;
  mostrarPainel();
  definirStatusDoPainel(`Preenchendo ${items.length} item(ns)...`);
  atualizarPainel();

  for (const [indice, item] of fila.entries()) {
    if (abortRequested) break;
    await aguardarSePausado();
    if (abortRequested) break;

    definirStatusDoPainel(`Item ${item.item}: preenchendo (${indice + 1}/${items.length})...`);
    atualizarPainel();
    avisarProgresso({
      item: item.item,
      indice: indice + 1,
      total: items.length,
      status: "preenchendo",
    });

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
        // Só considera "salvo" o item cujo Salvar foi clicado E que o site não
        // recusou (ex.: "O campo Valor unitário é obrigatório").
        if (outcome.salvamento.clicado && !outcome.salvamento.recusado) savedItems.push(item.item);
      }
    } catch (err) {
      errors.push(`Item ${item.item}: ${err.message}`);
    }

    showProgressBar(filled, items.length);
    atualizarPainel();
    await sleep(delayMs);
  }

  removeProgressBar();
  rodandoAgora = false;

  const semSalvar = items.length - savedItems.length;
  const confirmados = salvamentos.filter((s) => s.clicado && s.confirmado).length;
  definirStatusDoPainel(
    abortRequested
      ? `Parado: ${filled} de ${items.length} itens preenchidos.`
      : `${filled}/${items.length} preenchidos · ${confirmados} confirmados pelo site`,
  );
  atualizarPainel();
  avisarProgresso({ status: "fim", filled, total: items.length, confirmados, savedItems });
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
    // Campos que o site marcou como inválidos/obrigatórios mesmo preenchidos.
    camposProblematicos: [...diagnosticoDeCampos],
  };
}

async function fillSingleItem(item, allowUnassignedFields) {
  const itemNumber = String(item.item ?? "");

  // O item pode estar em outra página da lista (10 itens por página).
  const naPagina = await irParaItem(itemNumber);
  if (!naPagina) {
    return {
      ok: false,
      error: `Item ${itemNumber}: não está na página e não consegui chegar até ele (confira a paginação / se o item existe).`,
    };
  }

  let fields = await localizarCamposDoItem(itemNumber, allowUnassignedFields);
  if (!fields) {
    const naLista = numerosNaPagina().has(normalizeItemNumber(itemNumber));
    return {
      ok: false,
      error: naLista
        ? `Item ${itemNumber}: o item está na página, mas os campos de preenchimento não apareceram (tente abrir/expandir o item e rodar de novo).`
        : `Item ${itemNumber}: não encontrei este item na página (confira a paginação e se o item existe).`,
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
    await aguardarSePausado();
    if (abortRequested) return { ok: false, error: `Item ${itemNumber}: preenchimento interrompido.` };
    if (!field.value) continue;

    // Releitura após cada campo: páginas React/Angular podem recriar os inputs.
    scanPage();
    fields = getFieldsForItem(itemNumber, allowUnassignedFields);
    let input = fields?.get(field.key);

    // O painel do item pode ter sido remontado pelo site: procura de novo.
    if (!input) {
      const outraLeitura = await localizarCamposDoItem(itemNumber, allowUnassignedFields);
      input = outraLeitura?.get(field.key);
      if (input) fields = outraLeitura;
    }

    if (!input) {
      if (field.required) missing.push(FIELD_LABELS[field.key]);
      else warnings.push(`Item ${itemNumber}: campo ${FIELD_LABELS[field.key]} não localizado.`);
      continue;
    }

    const didFill = await setInputValue(input, field.value, field.key === "valorUnitario");
    if (!didFill) {
      // Diz o que o site deixou no campo: ajuda a entender a máscara dele.
      const ficou = String(input.value ?? "").trim();
      const detalhe = ficou ? ` (o site deixou "${ficou}" no campo)` : "";
      if (field.required) missing.push(`${FIELD_LABELS[field.key]}${detalhe}`);
      else warnings.push(`Item ${itemNumber}: não foi possível preencher ${FIELD_LABELS[field.key]}${detalhe}.`);
    }
    await pausa(120);
  }

  const lancamentos = lancamentosDoItem(fields);

  if (missing.length) {
    return {
      ok: false,
      error: `Item ${itemNumber}: campo(s) não preenchido(s): ${missing.join(", ")}.`,
      warnings,
      lancamentos,
    };
  }

  // Dá tempo para o site validar/computar (valor total, máscara) antes de salvar.
  await pausa(500);
  showNotification(`💾 Item ${itemNumber}: salvando...`, "info");
  const salvamento = await salvarItem(itemNumber, allowUnassignedFields, fields);

  if (salvamento.recusado) {
    warnings.push(
      `Item ${itemNumber}: o site RECUSOU o salvamento — ${salvamento.motivo}. Não marquei como enviado; confira os campos na página.`,
    );
    showNotification(`❌ Item ${itemNumber}: o site recusou — confira os campos`, "error");
  } else if (!salvamento.clicado) {
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

  return { ok: true, warnings, salvamento: { ...salvamento, lancamentos } };
}

function getFieldsForItem(itemNumber, allowUnassignedFields) {
  if (!latestScanState) return null;
  const key = normalizeItemNumber(itemNumber);
  const doGrupo = latestScanState.itemGroups.get(key)?.fields || new Map();

  // O grupo do item às vezes existe sem o campo de valor (o portal monta o
  // painel de preenchimento fora do contêiner que identifica o item). Nesse
  // caso, procura os campos dentro do bloco do próprio item.
  if (!doGrupo.has("valorUnitario")) {
    const doBloco = camposDoBloco(encontrarBlocoDoItem(itemNumber));
    if (doBloco.size) {
      const juntos = new Map(doGrupo);
      for (const [campo, controle] of doBloco) if (!juntos.has(campo)) juntos.set(campo, controle);
      return juntos;
    }
  }

  if (doGrupo.size) return doGrupo;

  // Só usa campos sem número de item quando há um único item sendo preenchido.
  if (allowUnassignedFields && latestScanState.itemGroups.size === 0) {
    return latestScanState.unassignedFields;
  }

  return null;
}

/** Bloco do item na lista (o que contém “Quantidade solicitada” etc.). */
function encontrarBlocoDoItem(itemNumber) {
  const alvo = normalizeItemNumber(itemNumber);
  if (!alvo) return null;
  for (const bloco of findItemBlocks({ exigirVisivel: false })) {
    if (normalizeItemNumber(itemNumberFromBlock(bloco)) === alvo) return bloco;
  }
  return null;
}

/** Campos reconhecidos dentro do bloco do item (valor unitário, marca...). */
function camposDoBloco(bloco) {
  const campos = new Map();
  if (!bloco) return campos;
  const controles = consultarProfundo(bloco, 'input, textarea, select, [contenteditable="true"], [role="textbox"]');
  for (const controle of controles) {
    if (!isFillable(controle) || !isVisible(controle)) continue;
    const campo = classifyField(controle);
    if (!campo) continue;
    if (!campos.has(campo) || getControlConfidence(controle, campo) > getControlConfidence(campos.get(campo), campo)) {
      campos.set(campo, controle);
    }
  }
  return campos;
}

/**
 * Acha os campos do item, insistindo até o painel aparecer.
 *
 * Depois de salvar um item o portal redesenha a lista — procurar os campos do
 * item seguinte nesse instante é o que fazia o bot “pular” um item. O PRAZO
 * desta espera é fixo (não acelera junto com a velocidade): o que a velocidade
 * muda é o intervalo entre as tentativas. Assim, mesmo a 0,001s, um item de
 * painel lento é esperado em vez de ser dado como perdido — e, quando o painel
 * responde rápido, o retorno é imediato.
 */
async function localizarCamposDoItem(itemNumber, allowUnassignedFields) {
  scanPage();
  let fields = getFieldsForItem(itemNumber, allowUnassignedFields);
  if (fields?.get("valorUnitario")) return fields;

  const prazo = Date.now() + Math.max(2000, Math.round(3000 * fatorRitmo));
  let ultimaTentativaDeAbrir = 0;

  while (Date.now() < prazo) {
    if (abortRequested) return null;
    await aguardarSePausado();

    // A seta de “mostrar detalhes” é o que monta o painel; se o primeiro
    // clique caiu num item que ainda estava redesenhando, tenta de novo.
    if (Date.now() - ultimaTentativaDeAbrir > 700) {
      await tryExpandItem(itemNumber);
      await pausa(300);
      ultimaTentativaDeAbrir = Date.now();
    }

    scanPage();
    fields = getFieldsForItem(itemNumber, allowUnassignedFields);
    if (fields?.get("valorUnitario")) return fields;

    await pausaConferencia(150);
  }

  scanPage();
  return getFieldsForItem(itemNumber, allowUnassignedFields);
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
  await pausa(400);
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

/** Só os dígitos de um texto ("1.232,8000" → "12328000"), sem zeros à frente. */
/** Zeros à esquerda não são dígito digitado: a máscara de centavos devolve
 *  "0,01" para a tecla "1" — é o MESMO dígito, não um dígito a mais. */
function semZerosADireita(texto) {
  return String(texto ?? "").replace(/^0+(?=\d)/, "");
}

/** Os dígitos dos dois textos são o mesmo número (ignorando zeros à esquerda)? */
function digitosIguais(a, b) {
  return semZerosADireita(a) === semZerosADireita(b);
}

function digitosDoTexto(texto) {
  return String(texto ?? "").replace(/\D/g, "").replace(/^0+/, "");
}

/** Espera o campo sair do valor atual (a máscara pode reagir depois da tecla). */
async function esperarCampoMudar(input, valorAntes, tempoMs = ESPERA_REACAO_MASCARA) {
  const limite = Date.now() + tempoMs;
  while (Date.now() < limite) {
    if (String(input.value ?? "") !== valorAntes) return true;
    await pausaConferencia(12);
  }
  return String(input.value ?? "") !== valorAntes;
}

/** Espera o campo parar de mudar (a máscara terminou de aplicar a tecla). */
async function esperarCampoParar(input, tempoMs = 150) {
  const limite = Date.now() + tempoMs;
  let anterior = String(input.value ?? "");
  let iguais = 0;
  while (Date.now() < limite) {
    await pausaConferencia(12);
    const agora = String(input.value ?? "");
    if (agora === anterior) {
      iguais += 1;
      if (iguais >= 2) return true;
    } else {
      iguais = 0;
      anterior = agora;
    }
  }
  return false;
}

/**
 * Espera o campo ficar com exatamente estes dígitos (a máscara pode aplicar a
 * tecla um pouco depois). Só observa: nunca escreve no campo.
 */
async function esperarDigitos(input, esperados, tempoMs = ESPERA_REACAO_MASCARA) {
  const limite = Date.now() + tempoMs;
  while (Date.now() < limite) {
    if (digitosIguais(digitosDoTexto(input.value), esperados)) return true;
    await pausaConferencia(8);
  }
  return digitosIguais(digitosDoTexto(input.value), esperados);
}

/** As casas decimais que a máscara do campo usa (o portal usa 4). */
function casasDaMascara(input) {
  for (const atributo of ["data-casas", "data-decimals", "data-decimal-places"]) {
    const declarado = Number(input?.getAttribute?.(atributo));
    if (Number.isInteger(declarado) && declarado > 0 && declarado <= 6) return declarado;
  }

  const doValor = casasDoTexto(input?.value) ?? casasDoTexto(input?.placeholder);
  if (Number.isFinite(doValor) && doValor > 0) return Math.min(6, doValor);

  // Alguns componentes de moeda não informam as casas no placeholder, mas
  // declaram que são moeda (normalmente duas casas).
  const moeda = input?.getAttribute?.("data-moeda");
  if (moeda && !/^(?:0|false|nao)$/i.test(moeda)) return 2;
  return CASAS_PADRAO;
}

/** O campo já está com o valor pedido? (texto formatado pelo site ou dígitos crus) */
function estaComOValorCerto(input, value, alvo, digitosAlvo) {
  if (campoVazio(input)) return false;
  if (digitosAlvo && digitosIguais(digitosDoTexto(input.value), digitosAlvo)) return true;
  if (alvo !== null) return mesmoNumero(valorNumerico(input.value), alvo);
  return normalizeText(input.value) === normalizeText(value);
}

/** Escreve o texto no campo — só quando a máscara não reage a tecla nenhuma. */
function escreverDireto(input, texto, view) {
  aplicarValor(input, texto, view);
  disparar(input, "input", view, { data: String(texto).slice(-1), inputType: "insertText" });
  return String(input.value ?? "") !== "";
}

/**
 * Esvazia o campo com Backspaces DE VERDADE.
 *
 * É o que a máscara do portal entende: cada Backspace passa pelo formulário (foi
 * assim que o usuário descobriu que a tecla faz o site contabilizar). Nada é
 * apagado por fora — apagar com execCommand/setter deixava o modelo do site
 * dessincronizado do que estava na tela, e era isso que fazia os dígitos
 * acumularem entre uma tentativa e outra (1.232,80 → 12.328,00 → 123.280,00).
 */
async function limparCampoComTeclas(input, view) {
  // A máscara do site costuma "segurar" um zero formatado (0,0000) em vez de
  // deixar o campo vazio: um campo só com zeros conta como vazio — os zeros à
  // frente não mudam o número que vai ser digitado.
  const semConteudo = () => campoVazio(input) || !/[1-9]/.test(String(input.value ?? ""));
  if (semConteudo()) return true;

  const teclaBackspace = { key: "Backspace", code: "Backspace", keyCode: 8, which: 8 };
  try {
    input.focus();
    if (typeof input.select === "function") input.select();
  } catch (_) {
    // sem foco/seleção: apaga tecla a tecla
  }

  let mascaraApagaSozinha = null; // aprendido na 1ª tecla (máscaras silenciosas)
  for (let voltas = 0; voltas < 80 && !semConteudo(); voltas += 1) {
    if (abortRequested) return semConteudo();
    const antes = String(input.value ?? "");
    disparar(input, "keydown", view, teclaBackspace);
    let apagou = await esperarCampoMudar(input, antes, mascaraApagaSozinha === false ? 12 : ESPERA_TECLA_MASCARA);
    if (mascaraApagaSozinha === null) mascaraApagaSozinha = apagou;
    if (!apagou) {
      // Máscara que não trata Backspace: apaga por conta e avisa o formulário.
      aplicarValor(input, antes.slice(0, -1), view);
      disparar(input, "input", view, { data: null, inputType: "deleteContentBackward" });
      apagou = String(input.value ?? "") !== antes;
    }
    disparar(input, "keyup", view, teclaBackspace);
    await pausaConferencia(8);
    if (!apagou) break; // não adianta insistir
  }

  return semConteudo();
}

/**
 * Digita o valor uma única vez e deixa a máscara do portal formatar os dígitos.
 *
 * Quando a máscara reage à tecla/input, não enviamos vírgula, ponto ou
 * separador de milhar: nesses campos cada tecla numérica representa um dígito
 * do valor e pontuação inserida por fora desloca a escala (por exemplo,
 * 1,0000 podia virar 10,0000). Em campos sem máscara continuamos enviando o
 * texto brasileiro completo.
 */
async function digitarTextoDoValor(input, texto, alvo, view) {
  let textoDigitado = texto;
  let tipoMascara = null; // "keydown" ou "input", detectado na primeira tecla
  let escritas = 0;

  for (let i = 0; i < textoDigitado.length; i += 1) {
    if (abortRequested) {
      return { ok: false, motivo: "preenchimento interrompido.", textoFinal: String(input.value ?? ""), escritas, tipoMascara };
    }
    await aguardarSePausado();

    const ch = textoDigitado[i];
    const valorAntes = String(input.value ?? "");
    const campoJaFormatado = casasDoTexto(valorAntes) !== null;
    const mascaraOuValorFormatado = tipoMascara !== null || campoJaFormatado;

    // Uma máscara de moeda só consome dígitos. Não lhe passe a pontuação do
    // texto formatado: o próprio campo deve colocar a vírgula e os milhares.
    if (mascaraOuValorFormatado && !/\d/.test(ch)) {
      await pausaDigitacao();
      continue;
    }

    const tecla = {
      key: ch,
      code: /[0-9]/.test(ch) ? `Digit${ch}` : "",
      char: ch,
      keyCode: ch.charCodeAt(0),
      which: ch.charCodeAt(0),
    };
    disparar(input, "keydown", view, tecla);
    disparar(input, "keypress", view, tecla);

    const janela = tipoMascara ? ESPERA_TECLA_MASCARA : i === 0 ? ESPERA_REACAO_MASCARA : ESPERA_TECLA_MASCARA;
    let mudou = await esperarCampoMudar(input, valorAntes, janela);
    if (!mudou && i === 0) mudou = await esperarCampoMudar(input, valorAntes, ESPERA_TECLA_MASCARA);

    if (mudou && /\d/.test(ch)) {
      tipoMascara = "keydown";
    } else if (!mudou) {
      // Um zero no valor vazio/zero formatado já está representado pela
      // máscara. Não o acrescente por fora: isso criaria uma casa a mais.
      const zeroJaRepresentado = ch === "0" && campoJaFormatado && mesmoNumero(valorNumerico(valorAntes), 0);
      if (!zeroJaRepresentado) {
        let inseriu = false;
        if (!input.isContentEditable && typeof input.ownerDocument?.execCommand === "function") {
          try {
            inseriu = input.ownerDocument.execCommand("insertText", false, ch);
          } catch (_) {
            inseriu = false;
          }
        }

        const valorSemMascara = valorAntes + ch;
        if (!inseriu) escreverDireto(input, valorSemMascara, view);
        escritas += 1;
        if (/\d/.test(ch) && String(input.value ?? "") !== valorSemMascara) {
          tipoMascara = "input";
        }
      }
    }

    disparar(input, "keyup", view, tecla);

    // Uma máscara de duas casas pode ser descoberta pelo primeiro resultado
    // (0,01). Ajustamos a sequência antes de continuar, sem limpar/recomeçar.
    if (i === 0 && tipoMascara) {
      const casasVisiveis = casasDoTexto(input.value);
      const casasPedidas = casasDoTexto(textoDigitado);
      if (casasVisiveis && casasPedidas && casasVisiveis !== casasPedidas) {
        const textoAjustado = comCasas(alvo, casasVisiveis);
        if (textoAjustado[0] === textoDigitado[0] && mesmoNumero(valorNumerico(textoAjustado), alvo)) {
          textoDigitado = textoAjustado;
        }
      }
    }

    const esperados = digitosDoTexto(textoDigitado.slice(0, i + 1));
    await esperarDigitos(input, esperados, tipoMascara ? ESPERA_REACAO_MASCARA : ESPERA_TECLA_MASCARA);

    const textoAtual = String(input.value ?? "");
    const atuais = digitosDoTexto(textoAtual);
    const valorParcialJaFormatado = casasDoTexto(textoAtual) !== null;
    if (!valorParcialJaFormatado && semZerosADireita(atuais).length > semZerosADireita(esperados).length) {
      return {
        ok: false,
        motivo: `a máscara aplicou dígito a mais ("${String(input.value).slice(0, 24)}")`,
        textoFinal: String(input.value ?? ""),
        escritas,
      };
    }

    await pausaDigitacao();
  }

  const textoFinal = String(input.value ?? "");
  const temSeparador = /\d[.,]\d/.test(textoFinal);
  const numero = valorNumerico(textoFinal);
  const alvoDigitos = digitosDoTexto(textoDigitado);
  const ok = temSeparador
    ? mesmoNumero(numero, alvo)
    : digitosIguais(digitosDoTexto(textoFinal), alvoDigitos) || mesmoNumero(numero, alvo);

  return {
    ok,
    motivo: ok ? "" : `o campo ficou com "${textoFinal.slice(0, 24) || "(vazio)"}"`,
    textoFinal,
    escritas,
    tipoMascara,
  };
}

/**
 * Escreve e confere o valor em uma única passada. Se a máscara não aceitar a
 * escala correta, interrompe o item em vez de apagar e lançar o valor de novo.
 */
async function escreverValorNoCampo(input, alvo, casas, view) {
  const texto = comCasas(alvo, casas); // sem separador de milhar: "1000,0000"
  const limpou = await limparCampoComTeclas(input, view);
  if (!limpou) {
    return {
      ok: false,
      motivo: "não consegui limpar o campo (nem com Backspace)",
      tentativas: 1,
      escritas: 0,
      textoFinal: String(input.value ?? ""),
      casasOk: false,
    };
  }

  const resultado = await digitarTextoDoValor(input, texto, alvo, view);
  contarLancamento(input);

  const textoFinal = String(input.value ?? "");
  const temSeparador = /\d[.,]\d/.test(textoFinal);
  const casasFinais = casasDoTexto(textoFinal);
  return {
    ...resultado,
    tentativas: 1,
    textoFinal,
    casasFinais,
    // O portal usa 4 casas. Se o campo exibir outra escala, o relatório avisa;
    // o bot não tenta reescrever o preço por cima.
    casasOk: !temSeparador || casasFinais === CASAS_PADRAO,
  };
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
  const ehTecla = tipo.startsWith("key");
  const Evento = ehInput && typeof view.InputEvent === "function"
    ? view.InputEvent
    : ehTecla && typeof view.KeyboardEvent === "function"
      ? view.KeyboardEvent
      : view.Event;
  try {
    el.dispatchEvent(new Evento(tipo, { bubbles: true, cancelable: ehInput, composed: true, ...dados }));
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
/** Insere texto caractere por caractere SEM limpar o campo (usado no nudge). */
async function inserirTexto(input, texto, view) {
  const doc = input.ownerDocument;
  const podeInsertText = !input.isContentEditable && typeof doc.execCommand === "function";
  let composto = String(input.value ?? "");

  for (const ch of [...String(texto)]) {
    const codigo = ch === " " ? "Space" : /[0-9]/.test(ch) ? `Digit${ch}` : /[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}` : "";
    const tecla = { key: ch, code: codigo, char: ch, keyCode: ch.charCodeAt(0), which: ch.charCodeAt(0) };
    const antesDaTecla = String(input.value ?? "");

    disparar(input, "keydown", view, tecla);
    disparar(input, "keypress", view, tecla);

    // A máscara pode inserir ao ver a tecla (ou um pouco depois): nunca insere
    // o caractere sem dar esse tempo a ela — era assim que os dígitos duplicavam.
    let mudou = String(input.value ?? "") !== antesDaTecla;
    if (!mudou && /[0-9]/.test(ch)) {
      mudou = await esperarCampoMudar(input, antesDaTecla, ESPERA_TECLA_MASCARA);
    }

    if (!mudou) {
      let inseriu = false;
      if (podeInsertText) {
        try {
          inseriu = doc.execCommand("insertText", false, ch);
        } catch (_) {
          inseriu = false;
        }
      }
      if (!inseriu) {
        composto = antesDaTecla + ch;
        aplicarValor(input, composto, view);
        disparar(input, "input", view, { data: ch, inputType: "insertText" });
      }
    }

    disparar(input, "keyup", view, tecla);
    composto = String(input.value ?? composto);
    await pausaDigitacao();
  }

  return !campoVazio(input);
}

async function digitarDeVerdade(input, value, view) {
  await limparCampoComTeclas(input, view);
  await inserirTexto(input, value, view);
  disparar(input, "change", view, { data: String(input.value ?? "") });
  await esperarCampoParar(input, 120);
  if (!campoVazio(input)) contarLancamento(input);
  return !campoVazio(input);
}

/**
 * Envia um Backspace para o portal contabilizar o valor, sem alterar o campo
 * quando o site não o processa como uma tecla nativa.
 *
 * Alguns campos reagem ao keydown e apagam o conteúdo selecionado. Colocamos o
 * cursor no fim antes da tecla e só redigitamos o último dígito se o valor
 * realmente mudou. Antes, quando a máscara não alterava o campo, o bot apagava
 * e reescrevia texto por conta própria; essa segunda escrita podia fazer a
 * máscara reinterpretar 67,4100 como 6,0000. Agora o valor é conferido e nunca
 * é restaurado por atribuição direta se a cutucada o corromper.
 */
async function cutucarCampo(input, view) {
  const antes = String(input.value ?? "");
  if (!antes) return false;
  const digitosAntes = digitosDoTexto(antes);
  const numeroAntes = valorNumerico(antes);
  const ultimoDigito = antes.match(/(\d)\D*$/)?.[1] || "";
  const teclaBackspace = { key: "Backspace", code: "Backspace", keyCode: 8, which: 8 };

  try {
    const fim = antes.length;
    input.setSelectionRange?.(fim, fim);
  } catch (_) {
    // Campos numéricos / componentes customizados podem não expor seleção.
  }

  disparar(input, "keydown", view, teclaBackspace);
  let mudou = await esperarCampoMudar(input, antes, 250);
  disparar(input, "keyup", view, teclaBackspace);
  if (!mudou) mudou = await esperarCampoMudar(input, antes, 80);

  // O site pode contabilizar no keydown sem mudar o valor (o caso comum). Não
  // simule uma remoção/reinserção: isso seria um segundo lançamento da quantia.
  if (!mudou) {
    const atual = String(input.value ?? "");
    return mesmoNumero(valorNumerico(atual), numeroAntes) &&
      (!digitosAntes || digitosDoTexto(atual) === digitosAntes);
  }

  await esperarCampoParar(input, 150);
  let atual = String(input.value ?? "");
  const valorMantido = mesmoNumero(valorNumerico(atual), numeroAntes) &&
    (!digitosAntes || digitosDoTexto(atual) === digitosAntes);
  if (valorMantido) return true;

  // A tecla apagou algo de verdade. Reinsere somente o dígito apagado — nunca
  // o valor inteiro — e verifica o resultado antes de permitir o Salvar.
  if (ultimoDigito) {
    try {
      const fim = atual.length;
      input.setSelectionRange?.(fim, fim);
    } catch (_) {
      // a digitação do dígito ainda pode funcionar sem seleção explícita
    }
    await inserirTexto(input, ultimoDigito, view);
    disparar(input, "change", view, { data: String(input.value ?? "") });
    await pausa(60);
  }

  atual = String(input.value ?? "");
  return mesmoNumero(valorNumerico(atual), numeroAntes) &&
    (!digitosAntes || digitosDoTexto(atual) === digitosAntes);
}

/**
 * O framework do site registrou o valor no formulário?
 * Angular marca `ng-invalid`/`ng-pristine`/`ng-untouched`; Bootstrap usa
 * `is-invalid`; outros usam `aria-invalid`. Se o campo continua "pristine"
 * depois de preenchido, o site não viu o evento de input.
 */
function estadoDeValidacao(el) {
  if (!el) return { invalido: false, pristine: false, mensagem: "" };
  const classe = String(el.className || "");
  const ariaInvalido = el.getAttribute("aria-invalid") === "true";
  const classeInvalida = /\b(ng-invalid|is-invalid|has-error)\b/i.test(classe);
  const pristine = /\b(ng-pristine|ng-untouched)\b/i.test(classe);

  let mensagem = "";
  const container = el.closest(".form-group, .campo, .field, [class*='form-field'], [class*='invalid']") || el.parentElement;
  if (container && (ariaInvalido || classeInvalida)) {
    const texto = (container.textContent || "").replace(/\s+/g, " ").trim();
    if (texto.length <= 160) mensagem = texto;
  }

  return { invalido: ariaInvalido || classeInvalida, pristine, mensagem };
}

/**
 * O campo pertence a um formulário controlado por framework (Angular e afins)?
 * Só nesses vale reforçar o evento — máscaras simples podem reagir mal a um
 * input manual e apagar o valor.
 */
function pistasDeFramework(el) {
  const classe = String(el?.className || "");
  if (/\bng-(pristine|untouched|dirty|touched|valid|invalid)\b/.test(classe)) return true;
  if (el?.getAttribute?.("aria-invalid") !== null && el?.getAttribute?.("aria-invalid") !== undefined) return true;
  if (/\b(is-invalid|has-error|was-validated|invalid-feedback)\b/i.test(classe)) return true;

  const container = el?.closest?.("form, .form-group, [class*='form-field'], mat-form-field, .p-field, fieldset");
  if (container && /\bng-(pristine|untouched|invalid)\b/.test(String(container.className || ""))) return true;
  return false;
}

/**
 * Reforça o valor já gravado no campo: dispara a sequência de eventos com o
 * VALOR FINAL (depois da máscara formatar) e repete um tick depois — muitos
 * componentes só leem o campo quando o evento chega com o texto já formatado.
 * Se a máscara apagar o valor, restaura o texto e desiste (sem estragar nada).
 */
async function reforcarValor(input, view) {
  const texto = String(input.value ?? "");
  if (!texto) return false;
  const numero = valorNumerico(texto);

  const restaurar = () => {
    aplicarValor(input, texto, view);
    return false;
  };

  aplicarValor(input, texto, view);
  disparar(input, "beforeinput", view, { data: texto, inputType: "insertText" });
  disparar(input, "input", view, { data: texto, inputType: "insertText" });
  await pausa(80);
  if (campoVazio(input)) return restaurar();

  const final = String(input.value ?? texto);
  if (!mesmoNumero(valorNumerico(final), numero)) return restaurar();

  aplicarValor(input, final, view);
  disparar(input, "input", view, { data: final, inputType: "insertText" });
  disparar(input, "change", view, { data: final });
  await pausa(80);
  if (campoVazio(input)) return restaurar();

  disparar(input, "blur", view, {});
  disparar(input, "focusout", view, {});
  try {
    input.blur();
  } catch (_) {
    // opcional
  }
  await pausa(60);
  return true;
}

/**
 * UMA tentativa de escrever o valor no campo: limpa e digita.
 *
 * Existe um único lançamento por tentativa. Os caminhos abaixo só valem quando
 * a máscara recusou e o campo ficou VAZIO — nada de reescrever (reforçar) o
 * valor depois de escrito: era isso que “lançava e relançava” o valor unitário.
 */
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

}

/**
 * Faz o formulário do site “ver” o valor que JÁ está no campo — uma vez só.
 *
 * Campo de valor: um Backspace de verdade + redigitar o último dígito (é o que
 * o portal exige para contabilizar; sem isso o total fica 0,0000).
 * Campo de texto em formulário de framework: reenvia o texto já formatado.
 */
async function garantirRegistroDoCampo(input, view, numerico, alvo, casas, cutucar = true) {
  if (numerico) {
    const digitosAlvo = alvo !== null && alvo !== undefined ? String(Math.round(alvo * 10 ** (casas ?? CASAS_PADRAO))) : "";

    // A cutucada envia apenas um Backspace; não reescreve o preço inteiro.
    // Alguns componentes alteram o campo com essa tecla: cutucarCampo só permite
    // prosseguir se o valor original for preservado exatamente.
    if (cutucar && !(await cutucarCampo(input, view))) return false;

    const valorAtual = String(input.value ?? "");
    const digitosOk = !digitosAlvo || digitosIguais(digitosDoTexto(valorAtual), digitosAlvo);
    const numeroOk = alvo === null || alvo === undefined || mesmoNumero(valorNumerico(valorAtual), alvo);
    if (!digitosOk && !numeroOk) return false;
    if (alvo !== null && alvo !== undefined && !numeroOk) return false;

    // O framework ainda não registrou? Reenvia o texto que JÁ está no campo,
    // mas só aceita o reforço se o número continuar idêntico ao valor pedido.
    const estado = estadoDeValidacao(input);
    if (pistasDeFramework(input) && (estado.pristine || estado.invalido)) {
      await reforcarValor(input, view);
      await pausa(80);
      const depois = estadoDeValidacao(input);
      const numeroPreservado = alvo === null || alvo === undefined || mesmoNumero(valorNumerico(input.value), alvo);
      return numeroPreservado && !depois.pristine && !depois.invalido;
    }
    return true;
  }

  const estado = estadoDeValidacao(input);
  if (pistasDeFramework(input) && (estado.pristine || estado.invalido)) {
    await reforcarValor(input, view); // último recurso: reenvia o texto formatado
    await pausa(80);
    const depois = estadoDeValidacao(input);
    return !depois.pristine && !depois.invalido;
  }

  return true;
}

/** O texto é mesmo um valor (só dígitos/separadores), ou um texto qualquer? */
function ehValorNumerico(texto) {
  const limpo = String(texto ?? "").trim();
  if (!limpo) return false;
  return /^(?:r\$\s*)?-?[\d.,\s]+$/i.test(limpo);
}

/** Casas decimais que um texto de valor usa ("44,0000" → 4). */
function casasDoTexto(texto) {
  const match = String(texto ?? "").match(/,\s*(\d{1,6})\s*$/);
  return match ? match[1].length : null;
}

/** Quantas vezes o valor foi lançado em cada campo (1 é o esperado). */
const lancamentosPorCampo = new Map();

function contarLancamento(input) {
  if (!input) return;
  if (lancamentosPorCampo.size > 300) lancamentosPorCampo.clear();
  lancamentosPorCampo.set(input, (lancamentosPorCampo.get(input) || 0) + 1);
}

/** Lançamentos por campo do item (vai para o relatório do popup). */
function lancamentosDoItem(fields) {
  const resultado = {};
  if (!fields) return resultado;
  for (const [campo, controle] of fields) {
    const total = lancamentosPorCampo.get(controle) || 0;
    if (total) resultado[campo] = total;
  }
  return resultado;
}

const CASAS_PADRAO = 4; // formato do portal: 44,0000

async function setInputValue(input, rawValue, esperaNumero) {
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
    await pausa(100);
    return true;
  }

  // Marca/modelo são TEXTO ("Conforme TR", "208"): não podem ser tratados como
  // valor só porque são números — quem diz isso é o campo (valor unitário).
  const numerico = esperaNumero !== false && ehValorNumerico(value);
  const alvo = numerico ? valorNumerico(value) : null;

  if (numerico && alvo !== null) {
    const casas = casasDaMascara(input);
    const digitosAlvo = String(Math.round(alvo * 10 ** casas));

    // Já está com o valor certo (o site já tinha o item preenchido)? NÃO
    // reescreve. Só permite seguir se a cutucada/revalidação preservar o preço.
    if (estaComOValorCerto(input, value, alvo, digitosAlvo)) {
      const estadoAntes = estadoDeValidacao(input);
      const precisaCutucar = estadoAntes.pristine || estadoAntes.invalido;
      const registrado = await garantirRegistroDoCampo(input, view, true, alvo, casas, precisaCutucar);
      const valorPreservado = mesmoNumero(valorNumerico(input.value), alvo);
      const estado = estadoDeValidacao(input);
      if (estado.invalido) registrarDiagnosticoDeCampo(input, { valor: value, invalido: true });
      if (!registrado || !valorPreservado) {
        registrarDiagnosticoDeCampo(input, {
          valor: String(input.value ?? ""),
          esperado: comCasas(alvo, casas),
          naoRegistrado: true,
        });
        return false;
      }
      return true;
    }

    // UMA passada (limpa + digita); se a máscara atrapalhar, interrompe o item.
    const resultado = await escreverValorNoCampo(input, alvo, casas, view);
    if (!resultado.ok) {
      registrarDiagnosticoDeCampo(input, { valor: value, naoRegistrado: true });
      return false;
    }

    // Depois de digitar, envie uma única tecla de registro. Alguns campos só
    // atualizam o total após Backspace; cutucarCampo reverte qualquer mudança
    // e abaixo só seguimos se o número continuar exatamente igual ao alvo.
    const registrado = await garantirRegistroDoCampo(input, view, true, alvo, casas, true);
    const valorPreservado = mesmoNumero(valorNumerico(input.value), alvo);
    if (!registrado || !valorPreservado) {
      registrarDiagnosticoDeCampo(input, {
        valor: String(input.value ?? ""),
        esperado: comCasas(alvo, casas),
        naoRegistrado: true,
      });
      return false;
    }

    const estado = estadoDeValidacao(input);
    if (estado.invalido) {
      registrarDiagnosticoDeCampo(input, { valor: value, invalido: true });
    } else if (!resultado.casasOk) {
      // Ex.: o campo voltou com 2 casas — o portal usa 4.
      registrarDiagnosticoDeCampo(input, { valor: value, casasErradas: true });
    }
    return true;
  }

  // Marca/Modelo (texto livre): digita e, se o framework ainda não registrou, reforça.
  await preencherCampo(input, value, view);
  if (Boolean(espera) && campoVazio(input)) {
    registrarDiagnosticoDeCampo(input, { valor: value, naoRegistrado: true });
    return false;
  }
  await garantirRegistroDoCampo(input, view, false);
  return true;
}


/**
 * Campos que o site marcou como inválidos mesmo depois de preenchidos ficam
 * guardados para o relatório (é o caso do "campo é obrigatório" falso).
 */
const diagnosticoDeCampos = [];

function registrarDiagnosticoDeCampo(input, info) {
  try {
    const entrada = {
      campo: input.id || input.name || input.getAttribute("aria-label") || input.className || "campo",
      valor: input.value,
      ...info,
    };
    if (!diagnosticoDeCampos.some((e) => e.campo === entrada.campo)) diagnosticoDeCampos.push(entrada);
  } catch (_) {
    // diagnóstico é opcional
  }
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
    await pausaConferencia(150);
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
    if (ehMensagemDeErro(mensagem)) continue;
    if (/(salv|cadastrad|gravad|sucesso|êxito|exito|atualizad|conclu[íi]d)/i.test(mensagem)) return mensagem;
  }
  return "";
}

/**
 * O site reclamou de algum campo? ("O campo "Valor unitário" é obrigatório.")
 * Essas mensagens nunca podem ser confundidas com salvamento.
 */
function ehMensagemDeErro(mensagem) {
  return /(obrigat[óo]ri|é\s+necess[áa]rio|preencha|inv[aá]lid|incorret|erro|error|falh|rejeit|n[ãa]o\s+(foi|p[oô]de|conseguiu|permitid)|não\s+informad|informe|selecione|deve\s+ser)/i.test(
    mensagem || "",
  );
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
  return {
    // Lista COM repetição: dois itens salvos geram o mesmo aviso duas vezes.
    avisos: avisosDaPagina(escopos).map(estadoDoAviso),
    // O painel pode confirmar sem toast (contagem de texto, valor total...).
    painel: escoposDoPainel(escopos, botao).map((escopo) =>
      (escopo.textContent || "").replace(/\s+/g, " ").trim().length,
    ),
    botaoVisivel: Boolean(botao?.isConnected && isVisible(botao)),
    botaoDesabilitado: Boolean(botao?.disabled),
    itensDesmontados: escopos.filter((escopo) => escopo?.isConnected === false).length,
  };
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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

  await aguardarSePausado();
  const mensagensAntes = coletarMensagens();
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

    // O site costuma responder rápido (toast), mas pode demorar um pouco.
    await pausa(800);

    const limite = Date.now() + (tentativa === 1 ? 2600 : 2200);
    let proximaChecagemModal = 0;
    while (Date.now() < limite) {
      if (Date.now() >= proximaChecagemModal) {
        proximaChecagemModal = Date.now() + 500;
        const modal = await responderModalDeConfirmacao();
        if (modal) {
          relatorio.modal = modal;
          if (modal.clicado) {
            confirmado = true;
            relatorio.mensagemSucesso = modal.texto || "confirmação na janela do site";
          }
          // Se há uma confirmação aberta, não clique novamente em Salvar.
          if (modal.texto || modal.clicado) break;
        }
      }

      mensagens = coletarMensagens();
      const novas = mensagens.filter((m) => !mensagensAntes.includes(m));

      // 1º de tudo: o site RECUSOU o salvamento? (campo obrigatório etc.)
      const recusa = novas.find(ehMensagemDeErro);
      if (recusa) {
        relatorio.recusado = true;
        relatorio.motivo = `o site recusou: "${recusa}"`;
        confirmado = false;
        break;
      }

      // 2º: mensagem de sucesso explícita.
      const sucesso = novas.find((m) => !ehMensagemDeErro(m) && /(salv|cadastrad|gravad|sucesso|êxito|exito|atualizad|conclu[íi]d)/i.test(m));
      if (sucesso) {
        confirmado = true;
        relatorio.mensagemSucesso = sucesso;
        break;
      }

      const agora = assinaturaDeSalvamento(ondeObservar, botao);
      const itemSumiu = Boolean(grupo?.container && !grupo.container.isConnected);
      if (itemSumiu || agora.itensDesmontados > antes.itensDesmontados) {
        confirmado = true; // a tela foi remontada (item salvo e recarregado)
        break;
      }

      const avisosMudaram = !igual(agora.avisos, antes.avisos);
      if (avisosMudaram && !mensagens.some(ehMensagemDeErro)) {
        confirmado = true; // apareceu um aviso/mensagem que não é de erro
        break;
      }

      const botaoMudou =
        agora.botaoVisivel !== antes.botaoVisivel || agora.botaoDesabilitado !== antes.botaoDesabilitado;
      if (botaoMudou) {
        confirmado = true; // o site desabilitou/escondeu o Salvar (gravou)
        break;
      }

      await pausaConferencia(250);
    }

    if (relatorio.recusado) break; // o site respondeu: não vale insistir
    if (confirmado) break;

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
    await pausa(700);
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

  if (!confirmado && relatorio.recusado) {
    // a mensagem já está no motivo
  } else if (!confirmado && mensagens.length) {
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
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  "dialog[open]",
  ".br-modal",
  ".modal.show",
  ".modal[style*=\"display: block\"]",
  ".modal-dialog",
  ".modal-content",
  ".modal-container",
  ".swal2-popup",
  ".swal-modal",
  ".sweet-alert",
  ".p-dialog",
  ".ui-dialog",
  ".cdk-overlay-pane",
  ".mat-dialog-container",
  ".mat-mdc-dialog-container",
  ".MuiDialog-paper",
].join(", ");

const SELETOR_DE_BOTAO_MODAL = "button, input[type='submit'], input[type='button'], [role='button'], a";
const TEXTO_BOTAO_CONFIRMAR = /^(salvar|gravar|confirmar|sim|ok|enviar|prosseguir|continuar|cadastrar)\s*!?$/i;
const TEXTO_BOTAO_NEGATIVO = /^(nao|cancelar|voltar|fechar|rejeitar|descartar|nao salvar)$/i;
const TEXTO_PERGUNTA_DE_CONFIRMAR = /(deseja\s+salvar|salvar\s+as\s+alteracoes|proposta.{0,120}modificad|confirm.{0,100}(?:proposta|item|cadastro|salvamento|alterac)|(?:proposta|item).{0,100}confirm)/i;

/** Está visível e não é fruto de um display "atualizado" só no shadow DOM? */
function visivelDeVerdade(el) {
  if (!el || !el.isConnected) return false;
  const visitados = new Set();
  let node = el;
  while (node && node.nodeType === 1 && !visitados.has(node)) {
    visitados.add(node);
    if (node.getAttribute?.("aria-hidden") === "true") return false;
    try {
      const view = node.ownerDocument?.defaultView || window;
      const estilo = view.getComputedStyle(node);
      if (estilo.display === "none" || estilo.visibility === "hidden" || estilo.visibility === "collapse") return false;
      if (Number.parseFloat(estilo.opacity || "1") === 0) return false;
    } catch (_) {
      if (node.style?.display === "none") return false;
    }
    // parentElement para DOM normal; host para componentes dentro de shadow DOM.
    node = node.parentElement || node.getRootNode?.()?.host || null;
  }
  return true;
}

function rotulosDoBotaoModal(el) {
  return [el?.textContent, el?.value, el?.getAttribute?.("aria-label"), el?.getAttribute?.("title")]
    .map((rotulo) => normalizeText(rotulo || ""))
    .filter(Boolean);
}

function ehBotaoNegativoModal(el) {
  return rotulosDoBotaoModal(el).some((rotulo) => TEXTO_BOTAO_NEGATIVO.test(rotulo));
}

function ehBotaoPositivoModal(el) {
  const rotulos = rotulosDoBotaoModal(el);
  return !ehBotaoNegativoModal(el) && rotulos.some((rotulo) => TEXTO_BOTAO_CONFIRMAR.test(rotulo));
}

function botoesVisiveisDaJanela(escopo) {
  return consultarProfundo(escopo, SELETOR_DE_BOTAO_MODAL)
    .filter((el) => visivelDeVerdade(el) && !el.disabled && el.getAttribute("aria-disabled") !== "true");
}

/**
 * O site pode pedir confirmação depois do Salvar. Primeiro tenta os seletores
 * comuns de diálogo; se o portal renderizar uma caixa sem role/aria/classe
 * conhecida, procura um ancestral visível que contenha a pergunta e os botões
 * afirmativo e negativo. Só clica num botão afirmativo explícito (nunca em Não).
 */
async function responderModalDeConfirmacao() {
  const candidatos = [];
  const vistos = new Set();

  const adicionarCandidato = (el, exigirDoisBotoes) => {
    if (!el || vistos.has(el) || !visivelDeVerdade(el)) return;
    vistos.add(el);
    const textoCompleto = normalizeText(el.innerText || el.textContent || "");
    if (!textoCompleto || textoCompleto.length > 1200 || !TEXTO_PERGUNTA_DE_CONFIRMAR.test(textoCompleto)) return;

    const botoes = botoesVisiveisDaJanela(el);
    const positivos = botoes.filter(ehBotaoPositivoModal);
    const negativos = botoes.filter(ehBotaoNegativoModal);
    if (positivos.length === 0 || (exigirDoisBotoes && negativos.length === 0)) return;

    // Prefere a caixa menor e aquela que apresenta explicitamente Não/Cancelar.
    candidatos.push({ el, textoCompleto, botoes, positivos, negativos, pontuacao: (negativos.length ? 1000 : 0) - textoCompleto.length });
  };

  for (const doc of collectDocuments()) {
    for (const el of consultarProfundo(doc, SELETOR_DE_MODAL)) adicionarCandidato(el, false);

    // Fallback para caixas como a do ComprasNet: apenas uma <div> com texto e
    // dois botões, sem atributos ARIA e sem uma classe de modal reconhecida.
    const botoes = botoesVisiveisDaJanela(doc);
    const afirmativos = botoes.filter(ehBotaoPositivoModal);
    for (const botao of afirmativos) {
      let ancestral = botao.parentElement || botao.getRootNode?.()?.host || null;
      for (let nivel = 0; ancestral && ancestral !== doc.body && nivel < 14; nivel += 1) {
        adicionarCandidato(ancestral, true);
        ancestral = ancestral.parentElement || ancestral.getRootNode?.()?.host || null;
      }
    }
  }

  candidatos.sort((a, b) => b.pontuacao - a.pontuacao);
  const candidato = candidatos[0];
  if (!candidato) return null;

  const texto = candidato.textoCompleto.slice(0, 160);
  const alvo = candidato.positivos[0];
  const rotulo = rotulosDoBotaoModal(alvo).find((label) => TEXTO_BOTAO_CONFIRMAR.test(label)) || "";
  if (!clicarDeVerdade(alvo)) return { texto, clicado: false, botao: rotulo };
  await pausa(900);
  return { texto, clicado: true, botao: rotulo };
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

// ─── Paginação da lista de itens (ComprasNet mostra 10 itens por página) ─────
//
// O portal pagina a lista: 1-10 na página 1, 11-20 na página 2 e assim por
// diante. Tanto a leitura quanto o preenchimento precisam navegar por essas
// páginas. Nunca clicamos em nada que lembre "Favoritos".

const SELETOR_PAGINACAO = [
  '[class*="pagination" i]',
  '[class*="paginacao" i]',
  '[class*="paginador" i]',
  '[class*="paging" i]',
  'nav[aria-label*="pág" i]',
  '[data-testid*="pagination" i]',
].join(", ");

const TEXTO_PROIBIDO_PAGINACAO = /favorit|salvar|imprimir|excluir|remover|sair|logout|voltar\s+ao\s+topo/i;
const TEXTO_PROXIMO = /^(»|›|>|\u203a|pr[oó]xim[ao]|próxima\s+p[áa]gina|next|avan[çc]ar)/i;
const TEXTO_ANTERIOR = /^(«|‹|<|\u2039|anterior|p[áa]gina\s+anterior|prev|voltar)/i;

/** Botões de página (números, próximo e anterior) da lista de itens. */
function controlesDePagina() {
  const candidatos = [];

  for (const doc of collectDocuments()) {
    for (const el of consultarProfundo(doc, `${SELETOR_PAGINACAO}, button, a, [role="button"]`)) {
      if (!isVisible(el) || el.disabled) continue;
      const rotulo = normalizeText(
        `${el.textContent || ""} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""}`,
      );
      if (!rotulo || TEXTO_PROIBIDO_PAGINACAO.test(rotulo)) continue;

      const emPaginacao = Boolean(el.closest?.(SELETOR_PAGINACAO));
      const numero = /^\d+$/.test(rotulo) ? rotulo : "";
      const proximo = TEXTO_PROXIMO.test(rotulo);
      const anterior = !proximo && TEXTO_ANTERIOR.test(rotulo);
      if (!numero && !proximo && !anterior) continue;
      // Fora de um contêiner de paginação, só aceita as setas de avançar/voltar.
      if (!emPaginacao && !proximo && !anterior) continue;

      const ativo =
        el.getAttribute("aria-current") === "page" ||
        /\b(active|current|selected|ativo|selecionado)\b/i.test(String(el.className || "")) ||
        (el.parentElement ? /\b(active|current|selected|ativo|selecionado)\b/i.test(String(el.parentElement.className || "")) : false);

      candidatos.push({ el, numero, proximo, anterior, ativo, emPaginacao });
    }
  }

  if (candidatos.length === 0) return null;

  const paginas = new Map();
  for (const c of candidatos) if (c.numero) paginas.set(c.numero, c.el);

  const ativo = candidatos.find((c) => c.ativo && c.numero);
  return {
    paginas,
    proximo: candidatos.find((c) => c.proximo)?.el || null,
    anterior: candidatos.find((c) => c.anterior)?.el || null,
    atual: ativo?.numero || "",
  };
}

/** Os números dos itens que estão no DOM agora (para saber se a página mudou). */
function assinaturaDaLista() {
  return findItemBlocks({ exigirVisivel: false })
    .map((bloco) => itemNumberFromBlock(bloco))
    .filter(Boolean)
    .join(",");
}

/** Números dos itens presentes na página atual (mesmo com os campos fechados). */
function numerosNaPagina() {
  const numeros = new Set();
  for (const bloco of findItemBlocks({ exigirVisivel: false })) {
    const numero = itemNumberFromBlock(bloco);
    if (numero) numeros.add(normalizeItemNumber(numero));
  }
  return numeros;
}

async function esperarListaMudar(antes, tempoMs = 5000) {
  const limite = Date.now() + tempoMs;
  while (Date.now() < limite) {
    await pausaConferencia(200);
    if (assinaturaDaLista() !== antes) {
      await pausaConferencia(250); // deixa o site terminar de montar os itens
      return true;
    }
  }
  return false;
}

/** Vai para a página número `numero` (1, 2, 3...). */
async function irParaPagina(numero) {
  const alvo = String(numero);
  const controles = controlesDePagina();
  if (!controles || controles.atual === alvo) return Boolean(controles && controles.atual === alvo);

  const botao = controles.paginas.get(alvo);
  if (!botao) return false;

  const antes = assinaturaDaLista();
  if (!clicarDeVerdade(botao)) return false;
  return esperarListaMudar(antes);
}

/** Avança uma página (seta "próxima"). */
async function avancarPagina() {
  const controles = controlesDePagina();
  if (!controles?.proximo) return false;
  const antes = assinaturaDaLista();
  if (!clicarDeVerdade(controles.proximo)) return false;
  return esperarListaMudar(antes);
}

/** Volta para a primeira página (para varrer a lista desde o começo). */
async function irParaPrimeiraPagina() {
  const controles = controlesDePagina();
  if (!controles) return false;
  if (controles.atual === "1") return true;
  if (await irParaPagina(1)) return true;

  // Sem botão "1": volta com a seta de anterior até o começo.
  for (let i = 0; i < 50; i += 1) {
    const atual = controlesDePagina();
    if (!atual?.anterior || atual.atual === "1") break;
    const antes = assinaturaDaLista();
    if (!clicarDeVerdade(atual.anterior)) break;
    if (!(await esperarListaMudar(antes))) break;
  }
  return true;
}

/**
 * Garante que o item pedido esteja na página atual, navegando se preciso.
 * Guarda em que página cada item já foi visto para não varrer tudo de novo.
 */
const paginaDoItem = new Map();

async function irParaItem(itemNumber) {
  const chave = normalizeItemNumber(itemNumber);

  if (numerosNaPagina().has(chave)) return true;

  const controles = controlesDePagina();
  if (!controles) return false; // lista sem paginação

  const tentarPagina = async (numero) => {
    if (!(await irParaPagina(numero))) return false;
    return numerosNaPagina().has(chave);
  };

  // Já sabemos (ou o site informa) em que página ele estava.
  const conhecida = paginaDoItem.get(chave);
  if (conhecida && (await tentarPagina(conhecida))) return true;

  if (!(await irParaPrimeiraPagina())) return false;

  for (let i = 0; i < 50; i += 1) {
    const numeros = numerosNaPagina();
    for (const numero of numeros) paginaDoItem.set(numero, String(i + 1));
    if (numeros.has(chave)) return true;
    if (!(await avancarPagina())) break;
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
  const identificacao = readPageIdentificacao();
  rodandoAgora = true;
  mostrarPainel();
  definirStatusDoPainel("Lendo os itens da página...");
  atualizarPainel();
  const avisos = [];
  const itens = [];
  const vistos = new Set();
  abortRequested = false;

  const controles = controlesDePagina();
  const temPaginacao = Boolean(controles?.paginas?.size || controles?.proximo);
  let paginasLidas = 0;
  let expandidos = 0;
  let expandiuTodos = false;

  // Navega pelas páginas (10 itens por página no ComprasNet) e junta tudo.
  if (temPaginacao) await irParaPrimeiraPagina();

  for (let pagina = 1; pagina <= 50; pagina += 1) {
    if (abortRequested) break;

    const resultado = await lerItensDaPaginaAtual({ expandir, delay, identificacao });
    if (!resultado.ok && pagina === 1) {
      return {
        ok: false,
        error: resultado.error,
        identificacao,
      };
    }
    if (!resultado.ok) break;

    paginasLidas += 1;
    expandidos += resultado.expandidos;
    expandiuTodos = expandiuTodos || Boolean(resultado.expandiuTodos);
    avisos.push(...resultado.avisos);

    let novos = 0;
    for (const item of resultado.itens) {
      const chave = normalizeItemNumber(item.numeroItem) || item.descricao;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      itens.push(item);
      novos += 1;
    }

    if (!temPaginacao || novos === 0) break;
    if (!(await avancarPagina())) break;
  }

  if (temPaginacao) {
    await irParaPrimeiraPagina(); // devolve a página como estava (início)
    avisos.push(`Páginas lidas: ${paginasLidas}.`);
  }

  rodandoAgora = false;
  definirStatusDoPainel(`Leitura concluída: ${itens.length} item(ns) em ${paginasLidas} página(s).`);
  atualizarPainel();

  if (itens.length === 0) {
    return {
      ok: false,
      error:
        "Não encontrei a lista de itens nesta página. Abra a página de cadastro de propostas do ComprasNet com os itens visíveis e tente novamente.",
      identificacao,
    };
  }

  return {
    ok: true,
    url: location.href,
    identificacao,
    itens,
    total: itens.length,
    expandidos,
    expandiuTodos,
    paginas: paginasLidas,
    avisos,
  };
}

/** Lê os itens que estão na página atual (uma "folha" da paginação). */
async function lerItensDaPaginaAtual({ expandir = true, delay = 400, identificacao } = {}) {
  const avisos = [];

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
      identificacao: identificacao || readPageIdentificacao(),
    };
  }

  const itens = [];
  let expandidos = 0;

  if (expandir) showProgressBar(0, blocos.length);

  for (const [index, bloco] of blocos.entries()) {
    if (abortRequested) {
      avisos.push("Leitura interrompida antes do fim da lista.");
      break;
    }
    await aguardarSePausado();
    if (abortRequested) break;

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

  return { ok: true, itens, total: itens.length, expandidos, expandiuTodos, avisos };
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

// ─── Ritmo (velocidade escolhida no popup) ───────────────────────────────────
//
// O usuário escolhe a pausa entre itens (de 0,03s a 5s). Ela vale para TUDO:
// digitação, esperas e conferência. Assim "0,03s" fica realmente rápido — se
// ficasse só a pausa entre itens, as esperas internas (mais de 2s por item)
// dominariam e a velocidade escolhida não mudaria quase nada na prática.

const DELAY_PADRAO_MS = 1000; // velocidade "Normal" (1s) — fator 1
const FATOR_RITMO_MIN = 0.001; // 1000x mais rápido (pausa de 0,001s)
const FATOR_RITMO_MAX = 4; // 4x mais devagar (≈ pausa de 4s)
const TEXTO_LENTO = 12; // ms entre teclas na digitação (velocidade normal)
const INTERVALO_MINIMO_CONFERENCIA = 20; // ms entre conferências do site
const ESPERA_REACAO_MASCARA = 200; // ms de tolerância ao conciliar os dígitos
const ESPERA_TECLA_MASCARA = 80; // ms esperando a máscara reagir (sai na hora)

let fatorRitmo = 1;

/** Ajusta o ritmo a partir da pausa pedida (em ms) e devolve o fator. */
function definirRitmo(delayMs) {
  const pedido = Number(delayMs);
  const base = Number.isFinite(pedido) && pedido > 0 ? pedido : DELAY_PADRAO_MS;
  fatorRitmo = Math.min(FATOR_RITMO_MAX, Math.max(FATOR_RITMO_MIN, base / DELAY_PADRAO_MS));
  return fatorRitmo;
}

/**
 * Pausa proporcional à velocidade escolhida.
 *
 * O piso é só 1ms: em 0,001s TUDO acelera junto (digitação, esperas e
 * conferência), que é o que o usuário pediu. O que garante o salvamento não é
 * a espera fixa, e sim a conferência: o bot só considera salvo quando o site
 * responde, e continua observando por até alguns segundos quando precisa.
 */
function pausa(ms) {
  return sleep(Math.max(1, Math.round(ms * fatorRitmo)));
}

/**
 * Pausa dos laços de conferência (esperar o site responder).
 *
 * Aqui existe um piso de verdade (20ms): sem ele, em velocidade máxima o bot
 * ficaria releitura da página a cada milissegundo e travaria o navegador — e
 * o site não teria tempo nenhum para responder entre uma checagem e outra.
 */
function pausaConferencia(ms) {
  return sleep(Math.max(INTERVALO_MINIMO_CONFERENCIA, Math.round(ms * fatorRitmo)));
}

/** Intervalo entre teclas na digitação (no turbo digita bem mais rápido). */
function pausaDigitacao() {
  return sleep(Math.max(2, Math.round(TEXTO_LENTO * fatorRitmo)));
}

/** Velocidade escolhida no popup (⚙️ Config/painel usam a mesma). */
async function lerVelocidadeSalva() {
  try {
    const cfg = await chrome.storage.local.get(["delayMs"]);
    const valor = Number(cfg?.delayMs);
    if (Number.isFinite(valor) && valor > 0) return valor;
  } catch (_) {
    // sem preferência salva: usa a padrão
  }
  return DELAY_PADRAO_MS;
}

// ─── Painel flutuante na página (não fecha junto com o popup) ────────────────
//
// O popup do Chrome fecha quando o usuário clica fora. Este painel vive na
// própria página do ComprasNet, mostra o andamento e tem os botões de
// Pausar/Continuar e Parar.

const PAINEL_ID = "__comprasnet_bot_painel__";
const PAINEL_POSICAO = "__comprasnet_bot_painel_pos__";

let rodandoAgora = false;
let painelStatus = "Pronto.";
const painelLog = [];

function removerPainel() {
  document.getElementById(PAINEL_ID)?.remove();
}

function registrarNoPainel(mensagem) {
  const texto = String(mensagem || "").replace(/\s+/g, " ").trim();
  if (!texto) return;
  painelLog.push(texto);
  while (painelLog.length > 8) painelLog.shift();
  if (document.getElementById(PAINEL_ID)) {
    const area = document.getElementById(`${PAINEL_ID}_log`);
    if (area) area.textContent = painelLog.join("\n");
  }
}

function definirStatusDoPainel(texto) {
  painelStatus = texto;
  const el = document.getElementById(`${PAINEL_ID}_status`);
  if (el) el.textContent = texto;
}

function atualizarPainel() {
  const painel = document.getElementById(PAINEL_ID);
  if (!painel) return;

  const ocupado = Boolean(rodandoAgora || rodandoPeloPainel);
  const iniciar = document.getElementById(`${PAINEL_ID}_iniciar`);
  if (iniciar) {
    iniciar.disabled = ocupado;
    iniciar.style.opacity = ocupado ? "0.6" : "1";
    iniciar.textContent = ocupado ? "⏳ Rodando..." : "▶ Iniciar";
  }
  const pausar = document.getElementById(`${PAINEL_ID}_pausar`);
  if (pausar) {
    // Pausar fica sempre disponível: dá para deixar o bot já pausado antes de
    // iniciar (ele espera você mandar continuar).
    pausar.textContent = botPausado ? "▶ Continuar" : "⏸ Pausar";
    pausar.style.background = botPausado ? "#168821" : "#6d28d9";
  }
  const parar = document.getElementById(`${PAINEL_ID}_parar`);
  if (parar) {
    parar.disabled = !ocupado;
    parar.style.opacity = ocupado ? "1" : "0.6";
  }
  const recarregar = document.getElementById(`${PAINEL_ID}_recarregar`);
  if (recarregar) recarregar.disabled = ocupado;
  const seletor = document.getElementById(`${PAINEL_ID}_proposta`);
  if (seletor) seletor.disabled = ocupado;

  const el = document.getElementById(`${PAINEL_ID}_status`);
  if (el) el.textContent = botPausado ? `⏸ Pausado — ${painelStatus}` : painelStatus;
}

function mostrarPainel() {
  if (document.getElementById(PAINEL_ID)) {
    atualizarPainel();
    return;
  }

  const painel = document.createElement("div");
  painel.id = PAINEL_ID;
  painel.style.cssText = [
    "position:fixed",
    "right:16px",
    "bottom:16px",
    "width:290px",
    "z-index:2147483647",
    "background-color:#fff",
    "color:#1f2937",
    "border:1px solid #cbd5e1",
    "border-radius:12px",
    "box-shadow:0 12px 32px rgba(15,23,42,0.28)",
    "font-size:12px",
    "line-height:1.45",
    "font-family:'Segoe UI',system-ui,sans-serif",
    "overflow:hidden",
  ].join(";");

  try {
    const salva = JSON.parse(localStorage.getItem(PAINEL_POSICAO) || "null");
    if (salva && Number.isFinite(salva.top) && Number.isFinite(salva.left)) {
      painel.style.right = "auto";
      painel.style.bottom = "auto";
      painel.style.top = `${salva.top}px`;
      painel.style.left = `${salva.left}px`;
    }
  } catch (_) {
    // posição é opcional
  }

  painel.innerHTML = `
    <div id="${PAINEL_ID}_topo" style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:#6d28d9;color:#fff;cursor:move;">
      <strong style="flex:1;font-size:12px;">🤖 ComprasNet Bot</strong>
      <button id="${PAINEL_ID}_fechar" title="Fechar painel" style="background:transparent;border:0;color:#fff;cursor:pointer;font-size:14px;">✕</button>
    </div>
    <div style="padding:10px;">
      <label style="display:block;font-weight:600;margin-bottom:4px;color:#334155;" for="${PAINEL_ID}_proposta">📋 Proposta a preencher</label>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <select id="${PAINEL_ID}_proposta" style="flex:1;min-width:0;padding:6px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;background:#fff;">
          <option value="">Carregando propostas…</option>
        </select>
        <button id="${PAINEL_ID}_recarregar" title="Recarregar propostas" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;cursor:pointer;">🔄</button>
      </div>
      <div id="${PAINEL_ID}_status" style="font-weight:600;margin-bottom:8px;">Pronto.</div>
      <div style="display:flex;gap:6px;">
        <button id="${PAINEL_ID}_iniciar" style="flex:1;padding:8px;border:0;border-radius:8px;background:#168821;color:#fff;font:inherit;font-weight:700;cursor:pointer;">▶ Iniciar</button>
        <button id="${PAINEL_ID}_pausar" style="flex:1;padding:8px;border:0;border-radius:8px;background:#6d28d9;color:#fff;font:inherit;font-weight:700;cursor:pointer;">⏸ Pausar</button>
        <button id="${PAINEL_ID}_parar" style="flex:1;padding:8px;border:0;border-radius:8px;background:#e52207;color:#fff;font:inherit;font-weight:700;cursor:pointer;">⏹ Parar</button>
      </div>
      <pre id="${PAINEL_ID}_log" style="margin:8px 0 0;max-height:110px;overflow:auto;white-space:pre-wrap;font-family:monospace;font-size:11px;line-height:1.4;color:#475569;"></pre>
      <div style="margin-top:6px;font-size:10px;color:#94a3b8;">Preenche e salva item por item · 10 itens por página</div>
    </div>`;

  document.body.appendChild(painel);

  document.getElementById(`${PAINEL_ID}_fechar`).addEventListener("click", removerPainel);
  document.getElementById(`${PAINEL_ID}_recarregar`).addEventListener("click", () => carregarPropostasNoPainel());
  document.getElementById(`${PAINEL_ID}_proposta`).addEventListener("change", () => atualizarPainel());
  document.getElementById(`${PAINEL_ID}_iniciar`).addEventListener("click", () => iniciarPeloPainel());
  document.getElementById(`${PAINEL_ID}_pausar`).addEventListener("click", () => {
    botPausado = !botPausado;
    registrarNoPainel(botPausado ? "⏸ Bot pausado." : "▶ Bot retomado.");
    atualizarPainel();
  });
  document.getElementById(`${PAINEL_ID}_parar`).addEventListener("click", () => {
    abortRequested = true;
    botPausado = false;
    registrarNoPainel("⏹ Parando depois do item atual...");
    atualizarPainel();
  });

  // Arrastar pelo cabeçalho.
  const topo = document.getElementById(`${PAINEL_ID}_topo`);
  let arrasto = null;
  topo.addEventListener("pointerdown", (evento) => {
    const rect = painel.getBoundingClientRect();
    arrasto = { dx: evento.clientX - rect.left, dy: evento.clientY - rect.top };
    evento.preventDefault();
  });
  window.addEventListener("pointermove", (evento) => {
    if (!arrasto) return;
    const left = Math.max(0, Math.min(window.innerWidth - painel.offsetWidth, evento.clientX - arrasto.dx));
    const top = Math.max(0, Math.min(window.innerHeight - 40, evento.clientY - arrasto.dy));
    painel.style.right = "auto";
    painel.style.bottom = "auto";
    painel.style.left = `${left}px`;
    painel.style.top = `${top}px`;
  });
  window.addEventListener("pointerup", () => {
    if (!arrasto) return;
    arrasto = null;
    try {
      localStorage.setItem(PAINEL_POSICAO, JSON.stringify({ left: painel.offsetLeft, top: painel.offsetTop }));
    } catch (_) {
      // posição é opcional
    }
  });

  const area = document.getElementById(`${PAINEL_ID}_log`);
  if (area) area.textContent = painelLog.join("\n");
  atualizarPainel();
  carregarPropostasNoPainel();
}

// ─── Propostas e execução pelo painel ───────────────────────────────────────

let propostasDoPainel = [];
let rodandoPeloPainel = false;

/**
 * Chama a API do sistema.
 *
 * O content script roda DENTRO da página do ComprasNet, então um fetch direto
 * esbarra em CORS ("Failed to fetch"). O caminho normal é pedir ao service
 * worker da extensão (que tem permissão de host) e receber o JSON de volta.
 * O fetch direto fica como reserva para ambientes onde a ponte não existe.
 */
async function chamarApi(url, { method = "GET", body, headers } = {}) {
  try {
    const ponte = await chrome.runtime.sendMessage({
      action: "api_request",
      url,
      method,
      headers: headers || (body ? { "Content-Type": "application/json" } : undefined),
      body,
    });
    if (ponte && (typeof ponte.status === "number" || ponte.ok)) {
      return { ok: Boolean(ponte.ok), status: ponte.status ?? 0, dados: ponte.dados, via: "extensão" };
    }
  } catch (_) {
    // sem ponte: tenta direto
  }

  const resposta = await fetch(url, {
    method,
    headers: headers || (body ? { "Content-Type": "application/json" } : undefined),
    body,
  });
  let dados = null;
  try {
    dados = await resposta.json();
  } catch (_) {
    dados = null;
  }
  return { ok: resposta.ok, status: resposta.status, dados, via: "página" };
}

/** URL do sistema configurada no popup (⚙️ Config). */
async function lerApiUrl() {
  try {
    const cfg = await chrome.storage.local.get(["apiUrl"]);
    return String(cfg?.apiUrl || "").replace(/\/+$/, "");
  } catch (_) {
    return "";
  }
}

/** Lê as propostas do sistema e monta o seletor "📋 Proposta a preencher". */
async function carregarPropostasNoPainel() {
  const select = document.getElementById(`${PAINEL_ID}_proposta`);
  if (!select) return;

  const apiUrl = await lerApiUrl();
  if (!apiUrl) {
    select.innerHTML = '<option value="">Configure a URL do sistema (⚙️ Config)</option>';
    definirStatusDoPainel("Configure a URL do sistema no popup (⚙️ Config).");
    atualizarPainel();
    return;
  }

  select.innerHTML = '<option value="">Carregando propostas…</option>';
  try {
    const resposta = await chamarApi(`${apiUrl}/api/propostas`);
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const propostas = resposta.dados;

    propostasDoPainel = (Array.isArray(propostas) ? propostas : []).sort(
      (a, b) => (b.itensPreenchidos || 0) - (a.itensPreenchidos || 0),
    );
    if (propostasDoPainel.length === 0) {
      select.innerHTML = '<option value="">Nenhuma proposta cadastrada</option>';
      definirStatusDoPainel("Nenhuma proposta no sistema ainda.");
      atualizarPainel();
      return;
    }

    const anterior = select.value;
    select.innerHTML = propostasDoPainel
      .map((p) => {
        const preenchidos = `${p.itensPreenchidos ?? 0}/${p.totalItens ?? 0}`;
        const env = p.itensEnviados ? ` · ${p.itensEnviados} enviados` : "";
        const uasg = p.uasg ? ` · UASG ${p.uasg}` : "";
        return `<option value="${p.id}">${escapeHtml(p.numeroDispensa || `Proposta ${p.id}`)}${uasg} — ${preenchidos} prontos${env}</option>`;
      })
      .join("");

    // Se o usuário já escolheu uma, mantém; senão abre na primeira que tem itens
    // preenchidos (é a "proposta preenchida" que ele quer enviar).
    const pronta = propostasDoPainel.find((p) => (p.itensPreenchidos || 0) > 0);
    if (anterior && propostasDoPainel.some((p) => String(p.id) === anterior)) {
      select.value = anterior;
    } else if (pronta) {
      select.value = String(pronta.id);
    }

    const total = propostasDoPainel.length;
    const comItens = propostasDoPainel.filter((p) => (p.itensPreenchidos || 0) > 0).length;
    definirStatusDoPainel(
      comItens
        ? `${total} proposta(s) no sistema · ${comItens} com itens preenchidos (selecionada a primeira).`
        : `${total} proposta(s) no sistema, nenhuma com itens preenchidos ainda.`,
    );
  } catch (erro) {
    select.innerHTML = '<option value="">Erro ao carregar propostas</option>';
    definirStatusDoPainel(
      `Não consegui ler as propostas (${erro.message}). Confira a URL do sistema em ⚙️ Config, se o site está no ar e se a extensão foi recarregada.`,
    );
  }
  atualizarPainel();
}

function escapeHtml(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** O botão "▶ Iniciar" do painel: preenche os itens da proposta escolhida. */
async function iniciarPeloPainel() {
  if (rodandoPeloPainel || rodandoAgora) {
    registrarNoPainel("⏳ Já existe um preenchimento em andamento.");
    return;
  }

  const select = document.getElementById(`${PAINEL_ID}_proposta`);
  const propostaId = select?.value;
  if (!propostaId) {
    definirStatusDoPainel("Escolha a proposta antes de iniciar.");
    atualizarPainel();
    return;
  }

  const apiUrl = await lerApiUrl();
  if (!apiUrl) {
    definirStatusDoPainel("Configure a URL do sistema no popup (⚙️ Config).");
    atualizarPainel();
    return;
  }

  const proposta = propostasDoPainel.find((p) => String(p.id) === String(propostaId));
  definirStatusDoPainel("Buscando os itens da proposta…");
  atualizarPainel();

  let dados;
  try {
    const resposta = await chamarApi(`${apiUrl}/api/propostas/${propostaId}/script`);
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    dados = resposta.dados;
  } catch (erro) {
    definirStatusDoPainel(`Não consegui ler os itens: ${erro.message}`);
    atualizarPainel();
    return;
  }

  const itens = Array.isArray(dados?.itens) ? dados.itens : [];
  if (itens.length === 0) {
    definirStatusDoPainel("Essa proposta não tem itens prontos (valor + marca) para preencher.");
    atualizarPainel();
    return;
  }

  rodandoPeloPainel = true;
  abortRequested = false;
  botPausado = false;
  atualizarPainel();
  const velocidade = await lerVelocidadeSalva();
  registrarNoPainel(
    `🚀 Iniciando ${itens.length} item(ns) de ${proposta?.numeroDispensa || `proposta ${propostaId}`}... (velocidade ${(velocidade / 1000).toFixed(2).replace(".", ",")}s)`,
  );

  try {
    const resultado = await fillItems(itens, velocidade);
    const salvos = new Set(resultado.savedItems || []);

    for (const erro of resultado.errors || []) registrarNoPainel(`❌ ${erro}`);
    for (const campo of resultado.camposProblematicos || []) {
      registrarNoPainel(
        `⚠️ Campo ${campo.campo} ficou com "${campo.valor}"${campo.esperado ? ` (esperado: ${campo.esperado})` : ""}; não salvei esse item.`,
      );
    }

    // Marca como enviado no sistema só o que foi realmente salvo na página.
    const paraMarcar = itens.filter((i) => i.id && salvos.has(normalizeItemNumero(i.item)));
    let marcados = 0;
    for (const item of paraMarcar) {
      try {
        const resposta = await chamarApi(`${apiUrl}/api/propostas/${propostaId}/itens/${item.id}`, {
          method: "PUT",
          body: JSON.stringify({ enviado: true }),
        });
        if (resposta.ok) marcados += 1;
      } catch (_) {
        // marcação é opcional: o importante é o que foi salvo na página
      }
    }

    definirStatusDoPainel(
      `${resultado.filled}/${resultado.total} preenchidos · ${salvos.size} salvos na página${marcados ? ` · ${marcados} marcados como enviados` : ""}`,
    );
    registrarNoPainel("🏁 Fim do preenchimento pelo painel.");
  } catch (erro) {
    definirStatusDoPainel(`Erro: ${erro.message}`);
    registrarNoPainel(`❌ ${erro.message}`);
  } finally {
    rodandoPeloPainel = false;
    atualizarPainel();
  }
}

/** Aceita tanto número quanto texto ("03" → "3") para casar itens. */
function normalizeItemNumero(valor) {
  const numero = Number(String(valor ?? "").replace(/\D/g, ""));
  return Number.isFinite(numero) && numero > 0 ? numero : String(valor ?? "");
}

/** Espera enquanto o bot estiver pausado (o Parar interrompe a espera). */
async function aguardarSePausado() {
  if (!botPausado) return;
  definirStatusDoPainel("Pausado pelo usuário.");
  atualizarPainel();
  while (botPausado && !abortRequested) await sleep(300);
  if (!abortRequested) definirStatusDoPainel("Rodando...");
  atualizarPainel();
}

/** Avisa o popup (se estiver aberto) do andamento — usado a cada item. */
function avisarProgresso(dados) {
  try {
    chrome.runtime.sendMessage({ action: "progresso", ...dados }, () => void chrome.runtime.lastError);
  } catch (_) {
    // popup fechado: sem problema
  }
}

// ─── Notificações na página ───────────────────────────────────────────────────

function showNotification(message, type = "info") {
  registrarNoPainel(message);
  removeNotification();

  const colors = {
    info: "#6d28d9",
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
    background: #6d28d9;
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
