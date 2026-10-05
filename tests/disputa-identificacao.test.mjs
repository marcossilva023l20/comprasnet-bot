import assert from "node:assert/strict";
import test from "node:test";
import { montarPagina } from "./extensao-harness/harness.mjs";
import { paginaDisputa } from "./extensao-harness/painel.mjs";

const propostaBase = { numeroDispensa: "53/2026", uasg: "781402" };

/** Executa o content.js real, mas toda API, confirmação e envio ficam no DOM sintético. */
function ambienteDisputa(proposta, { confirmar = false } = {}) {
  const confirmacoes = [];
  const lances = [];
  let resolverEnvio;
  const envio = new Promise((resolve) => { resolverEnvio = resolve; });
  const { window, enviar } = montarPagina(paginaDisputa(), {
    url: "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/fornecedor/enviar-lance",
    preparar: (w) => {
      w.confirm = (mensagem) => {
        confirmacoes.push(mensagem);
        return confirmar;
      };
      w.document.getElementById("enviar-1").addEventListener("click", () => {
        const valor = w.document.getElementById("novo-1").value;
        lances.push(valor);
        w.document.getElementById("meu-1").textContent = `R$ ${valor}`;
        w.document.getElementById("melhor-1").textContent = `R$ ${valor}`;
        resolverEnvio(valor);
      });
    },
  });
  window.__armazenamento.apiUrl = "https://app.exemplo.com";
  const propostaCadastrada = { ...propostaBase, ...proposta, id: 7, totalItens: 1, itensPreenchidos: 1 };
  const itens = [{ numeroItem: 1, descricao: "TOALHA MESA", valorUnitario: "130.0000", valorMinimo: "91.9000" }];
  window.fetch = async (url) => {
    const destino = String(url);
    let dados;
    if (destino.endsWith("/api/propostas/7/script")) dados = { proposta: propostaCadastrada };
    else if (destino.endsWith("/api/propostas/7/itens")) dados = itens;
    else if (destino.endsWith("/api/propostas")) dados = [propostaCadastrada];
    else return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => dados };
  };
  return { window, enviar, confirmacoes, lances, envio };
}

for (const numeroDispensa of [
  "53/2026",
  "00053/2026",
  "Dispensa Eletrônica Nº 53/2026",
  "UASG 781402 - 53/2026",
  "78140206000532026",
  " 78140206000532026 ",
]) {
  test(`identifica a dispensa cadastrada como ${JSON.stringify(numeroDispensa)}, sem enviar antes da autorização`, async (t) => {
    const ambiente = ambienteDisputa({ numeroDispensa });
    t.after(() => ambiente.window.close());
    const resultado = await ambiente.enviar({ action: "disputa_start", propostaId: "7" });
    assert.equal(resultado.canceled, true, resultado.error);
    assert.equal(ambiente.confirmacoes.length, 1);
    assert.match(ambiente.confirmacoes[0], /Dispensa 53\/2026 · UASG 781402/);
    assert.match(ambiente.confirmacoes[0], /R\$ 91,9000/);
    assert.equal((await ambiente.enviar({ action: "disputa_status" })).ativo, false);
    assert.equal(ambiente.window.document.getElementById("novo-1").value, "");
    assert.deepEqual(ambiente.lances, []);
  });
}

for (const [nome, proposta] of [
  ["outra compra por número/ano", { numeroDispensa: "54/2026" }],
  ["outro ano por número/ano", { numeroDispensa: "53/2025" }],
  ["outra compra no código completo", { numeroDispensa: "78140206000542026" }],
  ["outro ano no código completo", { numeroDispensa: "78140206000532025" }],
  ["UASG do código diferente do cadastro", { numeroDispensa: "99999906000532026" }],
  ["UASG do cadastro diferente do código e da página", { numeroDispensa: "78140206000532026", uasg: "999999" }],
  ["modalidade diferente de dispensa", { numeroDispensa: "78140205000532026" }],
  ["UASG não cadastrada", { numeroDispensa: "78140206000532026", uasg: "" }],
  ["código incompleto", { numeroDispensa: "7814020600532026" }],
  ["código com dígito extra", { numeroDispensa: "781402006000532026" }],
  ["código com compra zero", { numeroDispensa: "78140206000002026" }],
  ["código recebido como número com perda de precisão", { numeroDispensa: Number("78140206000532026") }],
  ["código de outra modalidade misturado com número/ano", { numeroDispensa: "78140205000532026 — 53/2026" }],
  ["dois números de compra ambíguos", { numeroDispensa: "53/2026 — 54/2026" }],
  ["ano com dígitos extras", { numeroDispensa: "53/202600" }],
  ["número ausente", { numeroDispensa: "" }],
]) {
  test(`bloqueia a identificação: ${nome}`, async (t) => {
    const ambiente = ambienteDisputa(proposta, { confirmar: true });
    t.after(() => ambiente.window.close());
    const resultado = await ambiente.enviar({ action: "disputa_start", propostaId: "7" });
    assert.equal(resultado.ok, false, resultado.message);
    assert.match(resultado.error, /não corresponde à página/);
    assert.equal(ambiente.confirmacoes.length, 0, "não pede autorização com identificação incompatível");
    assert.equal((await ambiente.enviar({ action: "disputa_status" })).ativo, false);
    assert.equal(ambiente.window.document.getElementById("novo-1").value, "");
    assert.deepEqual(ambiente.lances, []);
  });
}

test("o código 78140206000532026 inicia a dispensa 53/2026 e preserva o cálculo e o piso", { timeout: 10000 }, async (t) => {
  const ambiente = ambienteDisputa({ numeroDispensa: "78140206000532026" }, { confirmar: true });
  t.after(() => ambiente.window.close());
  const resultado = await ambiente.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(resultado.ok, true, resultado.error);
  assert.match(resultado.message, /53\/2026 · UASG 781402/);
  assert.equal(ambiente.confirmacoes.length, 1);
  assert.match(ambiente.confirmacoes[0], /R\$ 127,0000/);
  assert.match(ambiente.confirmacoes[0], /R\$ 91,9000/);
  assert.equal(await ambiente.envio, "127,0000");
  assert.deepEqual(ambiente.lances, ["127,0000"]);
  await ambiente.enviar({ action: "disputa_stop" });
});
