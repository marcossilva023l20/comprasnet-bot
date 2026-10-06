import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto, createHash } from "node:crypto";
import test from "node:test";
import { JSDOM } from "jsdom";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("public/extension/atualizar.html", root), "utf8");
const script = readFileSync(new URL("public/extension/atualizar.js", root), "utf8");
const catalogoOriginal = JSON.parse(readFileSync(new URL("public/extension-versions.json", root), "utf8"));
const hash = (t) => createHash("sha256").update(t).digest("hex");
const espera = async (predicado) => {
  for (let i = 0; i < 150; i++) { if (predicado()) return; await new Promise((r) => setTimeout(r, 2)); }
  assert.ok(predicado(), "a operação do atualizador não terminou");
};

function montar({ instalada = "1.7.20", confirmar = true, pacoteAlterado = null, corromper = false, adiar = null, falharArquivo = null } = {}) {
  const dom = new JSDOM(html, { url: "https://extensao.exemplo/atualizar.html", runScripts: "outside-only" });
  const { window } = dom;
  const requisicoes = [], gravados = [], confirmacoes = [], downloads = [], reloads = [], permissoes = [];
  const catalogo = structuredClone(catalogoOriginal);
  const pacotes = new Map(catalogo.versoes.map((v) => [v.versao, readFileSync(new URL(`public${v.arquivosUrl}`, root), "utf8")]));
  if (pacoteAlterado) {
    const texto = JSON.stringify(pacoteAlterado);
    pacotes.set(pacoteAlterado.versao, texto);
    catalogo.versoes.find((v) => v.versao === pacoteAlterado.versao).sha256 = hash(texto);
  }
  const arquivos = new Map();
  const fonte = JSON.parse(pacotes.get("1.7.20"));
  for (const a of fonte.arquivos) arquivos.set(a.caminho, a.texto !== undefined ? Buffer.from(a.texto) : Buffer.from(a.base64, "base64"));
  arquivos.set("manifest.json", Buffer.from(JSON.stringify({ ...JSON.parse(arquivos.get("manifest.json")), version: instalada })));
  const originais = new Map([...arquivos].map(([n, b]) => [n, Buffer.from(b)]));
  let falhou = false;
  const pasta = {
    name: "comprasnet-bot",
    queryPermission: async () => { permissoes.push("query"); return "granted"; },
    requestPermission: async () => "granted",
    removeEntry: async (nome) => arquivos.delete(nome),
    getFileHandle: async (nome, opcoes) => {
      if (!arquivos.has(nome) && !opcoes?.create) { const e = new Error("ausente"); e.name = "NotFoundError"; throw e; }
      return {
        getFile: async () => ({
          text: async () => arquivos.get(nome).toString("utf8"),
          arrayBuffer: async () => { const b = arquivos.get(nome); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
        }),
        createWritable: async () => {
          let temporario;
          return {
            write: async (bytes) => {
              gravados.push(nome);
              if (nome === falharArquivo && !falhou) { falhou = true; throw new Error("disco indisponível"); }
              temporario = Buffer.from(bytes);
            },
            close: async () => arquivos.set(nome, temporario),
            abort: async () => {},
          };
        },
      };
    },
  };
  window.TextEncoder = TextEncoder;
  Object.defineProperty(window, "crypto", { value: webcrypto });
  window.indexedDB = { open() { const req = {}; queueMicrotask(() => { req.error = new Error("IDB indisponível no teste"); req.onerror(); }); return req; } };
  window.chrome = {
    storage: { local: { get: async () => ({ apiUrl: "https://app.exemplo.com" }) } },
    runtime: { getManifest: () => ({ version: instalada }), reload: () => reloads.push(true) },
    tabs: { create: (d) => downloads.push(d.url) },
  };
  window.showDirectoryPicker = async () => pasta;
  window.confirm = (msg) => { confirmacoes.push(msg); return confirmar; };
  window.setTimeout = (fn) => { reloads.push(fn); return 1; };
  window.fetch = async (url, opts) => {
    const u = new URL(url); requisicoes.push(u.pathname);
    if (u.pathname === "/extension-versions.json") return { ok: true, json: async () => catalogo };
    const versao = u.pathname.split("/")[2];
    if (adiar && versao === adiar.versao && adiar.ativo) await adiar.promessa;
    return { ok: true, text: async () => (corromper ? "alterado" : pacotes.get(versao)), status: 200, signal: opts.signal };
  };
  window.eval(script);
  const escolher = async (v) => {
    const seletor = window.document.getElementById("versao-selecionada");
    seletor.value = v; seletor.dispatchEvent(new window.Event("change"));
    await espera(() => /pronta|já está|Não consegui preparar/.test(window.document.getElementById("status").textContent));
  };
  return { window, pasta, escolher, arquivos, originais, requisicoes, gravados, confirmacoes, downloads, reloads, permissoes };
}
async function inicializar(env) { await espera(() => env.window.document.getElementById("versao-publicada").textContent === "1.7.20" && !env.window.document.getElementById("btn-recarregar").disabled); }
async function conectar(env) { env.window.document.getElementById("btn-conectar").click(); await espera(() => env.window.document.getElementById("pasta-atual").textContent.includes("Pasta conectada")); }

test("selecionar uma versão ou baixar seu ZIP não grava arquivos nem recarrega a extensão", async (t) => {
  const env = montar(); t.after(() => env.window.close()); await inicializar(env);
  await env.escolher("1.7.19");
  assert.match(env.window.document.getElementById("versao-alerta").textContent, /voltando/);
  env.window.document.getElementById("btn-baixar").click();
  assert.deepEqual(env.downloads, ["https://app.exemplo.com/extension-releases/1.7.19/extension.zip"]);
  assert.deepEqual(env.gravados, []); assert.deepEqual(env.reloads, []); assert.deepEqual(env.confirmacoes, []);
});

test("cancelar a confirmação não pede permissão e não instala a versão anterior", async (t) => {
  const env = montar({ confirmar: false }); t.after(() => env.window.close()); await inicializar(env); await conectar(env); await env.escolher("1.7.19");
  env.window.document.getElementById("btn-atualizar").click();
  await espera(() => env.confirmacoes.length === 1);
  assert.match(env.confirmacoes[0], /1\.7\.20 para 1\.7\.19/);
  assert.deepEqual(env.gravados, []); assert.deepEqual(env.permissoes, []); assert.deepEqual(env.reloads, []);
});

test("instala exatamente a versão selecionada, grava o manifesto por último e bloqueia novas trocas até reload", async (t) => {
  const env = montar(); t.after(() => env.window.close()); await inicializar(env); await conectar(env); await env.escolher("1.7.19");
  env.window.document.getElementById("btn-atualizar").click();
  await espera(() => env.reloads.length === 1);
  assert.equal(env.gravados.length, 10); assert.equal(env.gravados.at(-1), "manifest.json");
  assert.equal(JSON.parse(env.arquivos.get("manifest.json")).version, "1.7.19");
  assert.equal(env.window.document.getElementById("versao-selecionada").disabled, true);
  assert.equal(env.window.document.getElementById("btn-atualizar").disabled, true);
});

test("falha de escrita restaura a cópia anterior sem declarar a nova versão ou fazer reload", async (t) => {
  const env = montar({ falharArquivo: "content.js" }); t.after(() => env.window.close()); await inicializar(env); await conectar(env); await env.escolher("1.7.19");
  env.window.document.getElementById("btn-atualizar").click();
  await espera(() => /cópia anterior foi restaurada/.test(env.window.document.getElementById("status").textContent));
  for (const [nome, bytes] of env.originais) assert.deepEqual(env.arquivos.get(nome), bytes, nome);
  assert.ok(!env.gravados.includes("manifest.json")); assert.deepEqual(env.reloads, []);
});

test("uma versão BETA tem aviso visível e exige confirmação explícita antes de instalar", async (t) => {
  const env = montar({ confirmar: false }); t.after(() => env.window.close()); await inicializar(env); await conectar(env); await env.escolher("1.8.9");
  const opcaoBeta = [...env.window.document.getElementById("versao-selecionada").options].find((opcao) => opcao.value === "1.8.9");
  assert.match(opcaoBeta.textContent, /BETA/);
  assert.doesNotMatch(opcaoBeta.textContent, /EXPERIMENTAL/i);
  assert.match(env.window.document.getElementById("versao-alerta").textContent, /BETA/);
  env.window.document.getElementById("btn-atualizar").click();
  assert.match(env.confirmacoes[0], /BETA/); assert.deepEqual(env.gravados, []);
});

test("um pacote com hash alterado fica bloqueado, mesmo quando o usuário já conectou a pasta", async (t) => {
  const env = montar({ corromper: true }); t.after(() => env.window.close()); await espera(() => /integridade/.test(env.window.document.getElementById("status").textContent)); await conectar(env);
  assert.equal(env.window.document.getElementById("btn-atualizar").disabled, true);
  assert.deepEqual(env.gravados, []);
});

test("um caminho de travessia no pacote é rejeitado antes de qualquer gravação", async (t) => {
  const original = JSON.parse(readFileSync(new URL("public/extension-releases/1.7.19/extension-files.json", root), "utf8"));
  original.arquivos[0].caminho = "../roubar.js";
  const env = montar({ pacoteAlterado: original }); t.after(() => env.window.close()); await inicializar(env); await conectar(env); await env.escolher("1.7.19");
  assert.equal(env.window.document.getElementById("btn-atualizar").disabled, true); assert.deepEqual(env.gravados, []);
});

test("resposta atrasada de uma seleção anterior não substitui o pacote da seleção nova", async (t) => {
  let liberar;
  const adiar = { versao: "1.7.19", ativo: false, promessa: new Promise((r) => { liberar = r; }) };
  const env = montar({ adiar }); t.after(() => env.window.close()); await inicializar(env); await conectar(env);
  adiar.ativo = true;
  const select = env.window.document.getElementById("versao-selecionada");
  select.value = "1.7.19"; select.dispatchEvent(new env.window.Event("change"));
  await env.escolher("1.8.6"); liberar();
  await new Promise((r) => setImmediate(r));
  env.window.document.getElementById("btn-atualizar").click();
  await espera(() => env.reloads.length === 1);
  assert.equal(JSON.parse(env.arquivos.get("manifest.json")).version, "1.8.6");
});

test("manifesto divergente da versão selecionada é rejeitado mesmo com um hash coerente", async (t) => {
  const original = JSON.parse(readFileSync(new URL("public/extension-releases/1.7.19/extension-files.json", root), "utf8"));
  const manifest = original.arquivos.find((a) => a.caminho === "manifest.json");
  manifest.texto = JSON.stringify({ ...JSON.parse(manifest.texto), version: "9.9.9" });
  manifest.bytes = Buffer.byteLength(manifest.texto);
  const env = montar({ pacoteAlterado: original }); t.after(() => env.window.close()); await inicializar(env); await conectar(env); await env.escolher("1.7.19");
  assert.equal(env.window.document.getElementById("btn-atualizar").disabled, true);
  assert.match(env.window.document.getElementById("status").textContent, /Manifesto/);
  assert.deepEqual(env.gravados, []);
});

test("se a extensão já estiver na versão BETA, o atualizador a mantém selecionada e não inicia downgrade", async (t) => {
  const env = montar({ instalada: "1.8.7" }); t.after(() => env.window.close()); await inicializar(env);
  assert.equal(env.window.document.getElementById("versao-selecionada").value, "1.8.7");
  assert.equal(env.window.document.getElementById("btn-atualizar").disabled, true);
  assert.match(env.window.document.getElementById("versao-alerta").textContent, /BETA/);
  assert.deepEqual(env.gravados, []);
  assert.deepEqual(env.reloads, []);
});
