import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import test from "node:test";

const html = readFileSync(new URL("../public/extension/popup.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../public/extension/popup.js", import.meta.url), "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));

function popup({ estado, itens }) {
  const dom = new JSDOM(html, { url: "chrome-extension://id/popup.html", runScripts: "outside-only" });
  const { window } = dom;
  const listeners = [];
  const mensagens = [];
  const requisicoes = [];
  const registrar = window.document.addEventListener.bind(window.document);
  window.document.addEventListener = (tipo, fn, opcoes) => { if (tipo !== "DOMContentLoaded") registrar(tipo, fn, opcoes); };
  window.chrome = {
    runtime: { getManifest: () => ({ version: "1.8.8" }), onMessage: { addListener: (fn) => listeners.push(fn) } },
    tabs: { sendMessage: async (_id, msg) => { mensagens.push(msg.action); return msg.action === "disputa_status" ? estado : { ok: true }; } },
  };
  window.fetch = async (url, options) => {
    requisicoes.push({ url: String(url), cache: options?.cache });
    return { ok: true, json: async () => itens };
  };
  window.eval(`${script}\ncurrentTab = { id: 99, url: 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/disputa' };\napiUrl = 'https://comprasnet-bot.vercel.app';\nbindEvents();`);
  const select = window.document.getElementById("disputa-proposta-select");
  select.innerHTML = '<option value="7">53/2026</option><option value="8">54/2026</option>';
  select.value = "7";
  const principal = window.document.getElementById("proposta-select");
  principal.innerHTML = select.innerHTML;
  principal.value = "7";
  return { window, listeners, mensagens, requisicoes };
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
