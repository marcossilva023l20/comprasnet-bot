/**
 * ComprasNet Preenchedor de Propostas - Content Script
 * Roda dentro das páginas do ComprasNet e preenche os campos.
 */

// Listen for messages from the popup/background
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "ping") {
    sendResponse({ ok: true, url: location.href });
    return true;
  }

  if (msg.action === "fill_items") {
    fillItems(msg.items, msg.delay || 800)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async
  }

  if (msg.action === "get_page_items") {
    const found = detectPageItems();
    sendResponse({ ok: true, items: found });
    return true;
  }
});

// ─── Detect items on page ────────────────────────────────────────────────────
function detectPageItems() {
  const items = [];

  // New ComprasNet (compras.gov.br) - dispensa eletrônica
  // Each item has a container with data-testid or class pattern
  const containers = document.querySelectorAll(
    '[class*="item-container"], [class*="item_container"], [class*="proposta-item"], section[id*="item"]'
  );

  containers.forEach((el) => {
    const numEl = el.querySelector('[class*="numero-item"], [class*="item-num"], [class*="num-item"]');
    if (numEl) {
      items.push({
        num: numEl.textContent?.trim(),
        el: el.className,
      });
    }
  });

  return items;
}

// ─── Main fill function ───────────────────────────────────────────────────────
async function fillItems(items, delayMs) {
  let filled = 0;
  const errors = [];

  showNotification(`🤖 Iniciando preenchimento de ${items.length} itens...`, "info");

  for (const item of items) {
    try {
      const ok = await fillSingleItem(item, delayMs);
      if (ok) {
        filled++;
        showProgressBar(filled, items.length);
      } else {
        errors.push(`Item ${item.item}: não encontrado na página`);
      }
    } catch (err) {
      errors.push(`Item ${item.item}: ${err.message}`);
    }
    await sleep(delayMs);
  }

  removeProgressBar();

  if (filled === items.length) {
    showNotification(`✅ ${filled} itens preenchidos com sucesso!`, "success");
  } else {
    showNotification(`⚠️ ${filled} de ${items.length} itens preenchidos. ${errors.length} erros.`, "warning");
  }

  return { filled, total: items.length, errors };
}

// ─── Fill a single item ───────────────────────────────────────────────────────
async function fillSingleItem(item, delayMs) {
  const num = item.item;

  // Strategy 1: New compras.gov.br (Angular/React SPA)
  // Items are collapsible sections identified by item number text
  const expanded = await tryExpandItem(num);

  await sleep(300);

  // Try to fill the three fields
  const valorFilled = await fillValorUnitario(num, item.valorUnitario);
  const marcaFilled = await fillMarcaFabricante(num, item.marcaFabricante);
  const modeloFilled = item.modeloVersao ? await fillModeloVersao(num, item.modeloVersao) : true;

  if (!valorFilled && !marcaFilled) {
    return false;
  }

  await sleep(200);

  // Click Salvar
  const saved = await clickSalvar(num);

  await sleep(delayMs);
  return saved || valorFilled;
}

// ─── Expand item section ──────────────────────────────────────────────────────
async function tryExpandItem(num) {
  // Find all expandable rows/sections on the page
  const allExpandable = [
    ...document.querySelectorAll('button[aria-expanded="false"], [class*="accordion"] button, [class*="collapse-header"], [class*="item-header"]'),
    ...document.querySelectorAll('a[data-toggle="collapse"], button[data-target*="item"]'),
  ];

  for (const btn of allExpandable) {
    const text = btn.textContent || "";
    const parent = btn.closest('[class*="item"], tr, li, section, div');
    const parentText = parent ? parent.textContent : "";

    // Check if this expand button belongs to our item number
    if (
      text.includes(`${num}`) ||
      parentText.match(new RegExp(`^\\s*${num}\\s`)) ||
      parentText.match(new RegExp(`\\bitem ${num}\\b`, "i"))
    ) {
      btn.click();
      await sleep(400);
      return true;
    }
  }

  // Strategy 2: look for chevron/arrow icon near item number
  const allElements = document.querySelectorAll("*");
  for (const el of allElements) {
    if (el.children.length > 0) continue; // only leaf nodes
    const txt = el.textContent?.trim();
    if (txt === String(num)) {
      // Found item number text — look for expand button nearby
      const row = el.closest("tr, li, [class*='row'], [class*='item']");
      if (row) {
        const btn = row.querySelector(
          'button, [class*="chevron"], [class*="expand"], [class*="toggle"], [class*="arrow"], svg'
        );
        if (btn) {
          const clickTarget = btn.closest("button") || btn;
          clickTarget.click();
          await sleep(400);
          return true;
        }
      }
    }
  }

  return false;
}

// ─── Field fillers ────────────────────────────────────────────────────────────
async function fillValorUnitario(num, value) {
  const selectors = [
    // New compras.gov.br patterns (inspect the real page for exact selectors)
    `input[placeholder*="0,00"]`,
    `input[id*="valorUnitario"]`,
    `input[id*="valor_unitario"]`,
    `input[name*="valorUnitario"]`,
    `input[name*="vlrUnitario"]`,
    `[data-cy*="valor-unitario"] input`,
    `[class*="valor-unitario"] input`,
    `[class*="valorUnitario"] input`,
    `td.valor input`,
    // Old comprasnet
    `input[name*="txtValorUnitario"]`,
    `input[id*="txtVlrUnitario"]`,
  ];

  return await fillField(selectors, value, num, "valor unitário");
}

async function fillMarcaFabricante(num, value) {
  const selectors = [
    `input[placeholder*="marca"]`,
    `input[placeholder*="fabricante"]`,
    `input[id*="marca"]`,
    `input[id*="Marca"]`,
    `input[name*="marca"]`,
    `[data-cy*="marca"] input`,
    `[class*="marca"] input`,
    `input[name*="txtMarca"]`,
  ];

  return await fillField(selectors, value, num, "marca/fabricante");
}

async function fillModeloVersao(num, value) {
  const selectors = [
    `input[placeholder*="modelo"]`,
    `input[placeholder*="versão"]`,
    `input[id*="modelo"]`,
    `input[id*="Modelo"]`,
    `input[name*="modelo"]`,
    `[data-cy*="modelo"] input`,
    `[class*="modelo"] input`,
    `input[name*="txtModelo"]`,
  ];

  return await fillField(selectors, value, num, "modelo/versão");
}

// Generic field filler - tries selectors, returns true if filled
async function fillField(selectors, value, itemNum, fieldName) {
  if (!value) return true;

  // First try: find visible inputs matching selectors in item context
  const itemContainers = findItemContainers(itemNum);

  for (const container of itemContainers) {
    for (const sel of selectors) {
      try {
        const input = container.querySelector(sel);
        if (input && isVisible(input)) {
          await setInputValue(input, value);
          return true;
        }
      } catch (_) { }
    }
  }

  // Second try: global search for visible inputs
  for (const sel of selectors) {
    try {
      const inputs = document.querySelectorAll(sel);
      for (const input of inputs) {
        if (isVisible(input)) {
          await setInputValue(input, value);
          return true;
        }
      }
    } catch (_) { }
  }

  console.warn(`[ComprasNet Bot] Campo "${fieldName}" não encontrado para item ${itemNum}`);
  return false;
}

function findItemContainers(num) {
  const containers = [];
  const allEls = document.querySelectorAll(
    '[class*="item"], [id*="item"], tr, section, article, [role="row"]'
  );

  for (const el of allEls) {
    const text = el.textContent || "";
    // Loosely check if this container is for our item number
    if (text.match(new RegExp(`^\\s*${num}\\s`)) || text.startsWith(`${num}\n`) || text.startsWith(`${num} `)) {
      // Only add leaf-level containers (not the whole page)
      if (el.textContent.length < 2000) {
        containers.push(el);
      }
    }
  }

  return containers;
}

async function clickSalvar(num) {
  // Find a Salvar button near the item
  const allBtns = document.querySelectorAll('button, input[type="submit"], input[type="button"]');

  for (const btn of allBtns) {
    const txt = (btn.textContent || btn.value || "").trim().toLowerCase();
    if ((txt === "salvar" || txt === "save" || txt === "confirmar") && isVisible(btn)) {
      btn.click();
      await sleep(600);
      return true;
    }
  }
  return false;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function setInputValue(input, value) {
  // React/Angular-aware value setting
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;

  input.focus();
  input.select();

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  input.blur();
  await sleep(100);
}

function isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0"
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── UI notifications ─────────────────────────────────────────────────────────
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
    animation: slideIn 0.3s ease;
  `;
  div.textContent = message;
  document.body.appendChild(div);

  if (type === "success" || type === "warning") {
    setTimeout(removeNotification, 5000);
  }
}

function removeNotification() {
  document.getElementById("__comprasnet_bot_notification__")?.remove();
}

function showProgressBar(current, total) {
  removeProgressBar();

  const pct = Math.round((current / total) * 100);
  const div = document.createElement("div");
  div.id = "__comprasnet_bot_progress__";
  div.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 999999;
    background: #1351b4;
    height: 4px;
  `;

  const bar = document.createElement("div");
  bar.style.cssText = `
    height: 100%;
    width: ${pct}%;
    background: #168821;
    transition: width 0.4s ease;
  `;

  const label = document.createElement("div");
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

  div.appendChild(bar);
  document.body.appendChild(div);
  document.body.appendChild(label);
}

function removeProgressBar() {
  document.getElementById("__comprasnet_bot_progress__")?.remove();
  document.querySelectorAll('[style*="comprasnet_bot"]').forEach((e) => e.remove());
}

// Let the popup know the content script is loaded
window.__comprasnet_bot_ready__ = true;
