import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const html = readFileSync(new URL("../public/extension/popup.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../public/extension/popup.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../public/extension/manifest.json", import.meta.url), "utf8"));

function montarPopup(resposta) {
  const dom = new JSDOM(html, { url: "chrome-extension://comprasnet-bot/popup.html", runScripts: "outside-only" });
  const { window } = dom;
  const mensagens = [];
  const copias = [];
  const requisicoes = [];
  // Exercita os handlers reais isolados, sem o carregamento inicial de propostas/configuração.
  const registrar = window.document.addEventListener.bind(window.document);
  window.document.addEventListener = (evento, callback, opcoes) => {
    if (evento !== "DOMContentLoaded") registrar(evento, callback, opcoes);
  };
  window.chrome = {
    runtime: { getManifest: () => manifest, onMessage: { addListener() {} } },
    tabs: {
      sendMessage: async (tabId, mensagem) => {
        mensagens.push({ tabId, action: mensagem.action });
        return resposta;
      },
    },
  };
  window.fetch = async (...args) => {
    requisicoes.push(args);
    throw new Error("O diagnóstico não pode consultar a API");
  };
  window.confirm = () => { throw new Error("O diagnóstico não pode pedir autorização de lance"); };
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async (texto) => copias.push(texto) } });
  window.eval(`${script}\ncurrentTab = { id: 73, url: 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/lances' };\nbindEvents();`);
  return { window, mensagens, copias, requisicoes };
}

const assentarEventos = () => new Promise((resolve) => setImmediate(resolve));

test("os botões do popup diagnosticam e copiam sem iniciar disputa ou consultar a API", async (t) => {
  const diagnostico = { somenteLeitura: true, itens: [{ numeroItem: "1", melhor: "R$ 127,0000", meu: "R$ 130,0000", campoEncontrado: true }] };
  const env = montarPopup({ ok: true, diagnostico, message: "Leitura concluída; nenhum lance foi enviado." });
  t.after(() => env.window.close());
  const doc = env.window.document;
  assert.ok(doc.getElementById("disputa-diagnostico-area").classList.contains("hidden"));
  doc.getElementById("disputa-diagnostico-btn").click();
  await assentarEventos();
  const area = doc.getElementById("disputa-diagnostico-texto");
  assert.equal(area.readOnly, true);
  assert.equal(doc.getElementById("disputa-diagnostico-area").classList.contains("hidden"), false);
  assert.equal(doc.getElementById("disputa-diagnostico-btn").disabled, false);
  const relatorio = JSON.parse(area.value);
  assert.equal(relatorio.versaoExtensao, manifest.version);
  assert.equal(relatorio.abaAlvo, 73);
  assert.equal(relatorio.somenteLeitura, true);
  assert.deepEqual(relatorio.itens, diagnostico.itens);
  assert.deepEqual(env.copias, []);
  doc.getElementById("disputa-copy-diagnostico-btn").click();
  await assentarEventos();
  assert.deepEqual(env.copias, [area.value]);
  assert.deepEqual(env.mensagens, [{ tabId: 73, action: "disputa_diagnosticar" }]);
  assert.deepEqual(env.requisicoes, []);
});

test("a recusa do diagnóstico não deixa um relatório antigo disponível para copiar", async (t) => {
  const env = montarPopup({ ok: false, error: "Pare o Modo Disputa antes de ler o diagnóstico sem envio." });
  t.after(() => env.window.close());
  const doc = env.window.document;
  const area = doc.getElementById("disputa-diagnostico-texto");
  area.value = "Relatório antigo";
  doc.getElementById("disputa-diagnostico-area").classList.remove("hidden");
  doc.getElementById("disputa-diagnostico-btn").click();
  await assentarEventos();
  assert.equal(area.value, "");
  assert.ok(doc.getElementById("disputa-diagnostico-area").classList.contains("hidden"));
  assert.match(doc.getElementById("disputa-availability").textContent, /Pare o Modo Disputa/);
  assert.equal(doc.getElementById("disputa-diagnostico-btn").disabled, false);
  assert.deepEqual(env.copias, []);
  assert.deepEqual(env.requisicoes, []);
});
