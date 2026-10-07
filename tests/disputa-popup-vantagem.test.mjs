import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import test from "node:test";

const html = readFileSync(new URL("../public/extension/popup.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../public/extension/popup.js", import.meta.url), "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));

function popup({ estado, itens, tabUrl, preloadedItems = [], selectedItemIds = [] }) {
  const dom = new JSDOM(html, { url: "chrome-extension://id/popup.html", runScripts: "outside-only" });
  const { window } = dom;
  const listeners = [];
  const mensagens = [];
  const mensagensDetalhadas = [];
  const requisicoes = [];
  const registrar = window.document.addEventListener.bind(window.document);
  window.document.addEventListener = (tipo, fn, opcoes) => { if (tipo !== "DOMContentLoaded") registrar(tipo, fn, opcoes); };
  window.chrome = {
    runtime: { getManifest: () => ({ version: "1.8.12" }), onMessage: { addListener: (fn) => listeners.push(fn) } },
    tabs: { sendMessage: async (_id, msg) => { mensagens.push(msg.action); mensagensDetalhadas.push(msg); return msg.action === "disputa_status" ? estado : { ok: true }; } },
  };
  window.fetch = async (url, options) => {
    requisicoes.push({ url: String(url), cache: options?.cache });
    return { ok: true, json: async () => itens };
  };
  const endereco = tabUrl || "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/disputa";
  window.eval(`${script}
currentTab = { id: 99, url: ${JSON.stringify(endereco)} };
apiUrl = 'https://comprasnet-bot.vercel.app';
allItems = ${JSON.stringify(preloadedItems)};
selectedIds = new Set(${JSON.stringify(selectedItemIds)});
window.__runBot = () => runBot();
bindEvents();`);
  const select = window.document.getElementById("disputa-proposta-select");
  select.innerHTML = '<option value="7">53/2026</option><option value="8">54/2026</option>';
  select.value = "7";
  const principal = window.document.getElementById("proposta-select");
  principal.innerHTML = select.innerHTML;
  principal.value = "7";
  return { window, listeners, mensagens, mensagensDetalhadas, requisicoes };
}
async function aguardar(fn) {
  for (let i = 0; i < 30; i++) { if (fn()) return; await tick(); }
  assert.ok(fn(), "a atualização do popup não terminou");
}

test("o refresh manual lê o piso sem iniciar automação e mostra estado por polegar", async (t) => {
  const env = popup({
    estado: { ok: true, ativo: false, situacoes: [
      { numeroItem: "1", estado: "perdendo", cor: "vermelho" },
      { numeroItem: "3", estado: "vencendo", cor: "verde" },
      { numeroItem: "6", estado: "indefinido", motivo: "indicador_ausente" },
    ] },
    itens: [
      { numeroItem: "1", descricao: "TOALHA", valorUnitario: "130.0000", valorMinimo: "126.5000" },
      { numeroItem: "3", descricao: "RESISTÊNCIA", valorUnitario: "200.0000", valorMinimo: "150.0000" },
      { numeroItem: "6", descricao: "CABO", valorUnitario: "20.0000", valorMinimo: "15.0000" },
    ],
  });
  t.after(() => env.window.close());
  env.window.document.getElementById("disputa-refresh-btn").click();
  await aguardar(() => env.window.document.getElementById("disputa-items-list").textContent.includes("TOALHA"));
  const linhas = [...env.window.document.querySelectorAll("#disputa-items-list .item-row")].map((e) => e.textContent);
  assert.match(linhas[0], /Mín\. 126,5000.*perdendo \(vermelho\)/);
  assert.match(linhas[1], /Mín\. 150,0000.*vencendo \(verde\)/);
  assert.match(linhas[2], /estado incerto — sem lance/);
  assert.equal(env.requisicoes.length, 1);
  assert.equal(new URL(env.requisicoes[0].url).pathname, "/api/propostas/7/itens");
  assert.equal(env.requisicoes[0].cache, "no-store");
  assert.deepEqual(env.mensagens, ["disputa_status"]);
  assert.match(env.window.document.getElementById("disputa-availability").textContent, /Consulta manual/);
});

test("o botão 📖 Ler página pede uma leitura somente informativa ao content script", async (t) => {
  const env = popup({ estado: { ok: true, ativo: false, situacoes: [] }, itens: [] });
  t.after(() => env.window.close());
  env.window.document.getElementById("disputa-read-page-btn").click();
  await aguardar(() => env.window.document.getElementById("disputa-read-status").textContent.includes("Página lida com sucesso"));
  assert.deepEqual(env.mensagens, ["disputa_ler_pagina"]);
  assert.deepEqual(env.requisicoes, []);
  assert.match(env.window.document.getElementById("disputa-read-status").textContent, /Página lida com sucesso/);
});

test("o cadastro seguro do CNET não é bloqueado como fonte pública e inicia o preenchimento", async (t) => {
  const url = "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/proposta/123";
  const env = popup({
    estado: { ok: true, ativo: false, situacoes: [] },
    itens: [],
    tabUrl: url,
    preloadedItems: [{ id: 1, numeroItem: "1", valorUnitario: "50.0000", marcaFabricante: "ACME", modeloVersao: "A1" }],
    selectedItemIds: [1],
  });
  t.after(() => env.window.close());
  assert.equal(env.window.isComprasNetPage(url), true);
  assert.equal(env.window.isCnetMobilePage(url), false);
  assert.equal(env.window.isSourceOnlyPage(url), false);
  const urlPublico = "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras";
  assert.equal(env.window.isSourceOnlyPage(urlPublico), true);
  assert.equal(env.window.nomeFonteItens(urlPublico), "CNET Mobile");
  await env.window.__runBot();

  assert.ok(env.mensagens.includes("ping"), "o popup verificou a página do Compras.gov.br");
  assert.ok(env.mensagens.includes("scan_page"), "o popup fez a leitura inicial da tela segura");
  assert.ok(env.mensagens.includes("fill_items"), "o popup enviou os dados para preencher e salvar");
  const envio = env.mensagensDetalhadas.find((msg) => msg.action === "fill_items");
  assert.deepEqual(JSON.parse(JSON.stringify(envio?.items)), [{ item: "1", valorUnitario: "50,0000", marcaFabricante: "ACME", modeloVersao: "A1" }]);
});

test("o refresh manual não exibe pisos de outra proposta enquanto o monitoramento está ativo", async (t) => {
  const env = popup({ estado: { ok: true, ativo: true, propostaId: "8", situacoes: [] }, itens: [] });
  t.after(() => env.window.close());
  env.window.document.getElementById("disputa-refresh-btn").click();
  await aguardar(() => /monitoramento usa outra proposta/i.test(env.window.document.getElementById("disputa-availability").textContent));
  assert.deepEqual(env.requisicoes, []);
});

test("ao monitorar, o popup bloqueia a troca de proposta até o usuário parar", async (t) => {
  const env = popup({ estado: { ok: true, ativo: false, situacoes: [] }, itens: [] });
  t.after(() => env.window.close());
  const msg = env.listeners[0];
  assert.equal(env.window.document.getElementById("disputa-proposta-select").disabled, false);
  msg({ action: "disputa_progress", ativo: true, propostaId: "7", status: "Monitoramento ativo.", situacoes: [] });
  assert.equal(env.window.document.getElementById("disputa-proposta-select").disabled, true);
  assert.equal(env.window.document.getElementById("proposta-select").disabled, true);
  assert.equal(env.window.document.getElementById("disputa-start-btn").disabled, true);
  assert.equal(env.window.document.getElementById("disputa-stop-btn").disabled, false);
  msg({ action: "disputa_progress", ativo: false, propostaId: "7", status: "Monitoramento parado.", situacoes: [] });
  assert.equal(env.window.document.getElementById("disputa-proposta-select").disabled, false);
  assert.equal(env.window.document.getElementById("disputa-start-btn").disabled, false);
  assert.equal(env.window.document.getElementById("disputa-stop-btn").disabled, true);
});
