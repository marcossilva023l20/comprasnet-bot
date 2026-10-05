import assert from "node:assert/strict";
import test from "node:test";
import { montarPagina } from "./extensao-harness/harness.mjs";

/** Layout sintético baseado no print: cabeçalho à esquerda, formulário em outra coluna. */
function paginaEmColunas({ itens = [{ numero: 1 }], concatenado = false, tipoAcao = "a", entradaPercentual = false, criterio = "", entradaAmbigua = false, duplicarForm = false } = {}) {
  const linha = (item) => {
    const n = item.numero;
    const rotulo = (texto) => concatenado ? texto.replace(" (", "(") : texto;
    const formulario = () => `<div class="col-sm-4 formulario-lance">
      <div><span>${rotulo("Melhor valor (unitário)")}</span><span id="melhor-${n}">${item.moeda === false ? `${item.melhor || "127,0000"}%` : `R$ ${item.melhor || "127,0000"}`}</span></div>
      <div><span>${rotulo("Meu valor (unitário)")}</span><span id="meu-${n}">${item.moeda === false ? `${item.meu || "130,0000"}%` : `R$ ${item.meu || "130,0000"}`}</span></div>
      <div class="entrada-lance"><span>${rotulo("Novo lance (unitário)")}</span><input id="novo-${n}" type="text" ${entradaPercentual ? 'aria-label="Desconto (%)"' : ""}>${entradaAmbigua ? '<input type="text">' : ""}</div>
      <div class="rodape-lance"><small>Intervalo mínimo entre lances: ${item.intervalo || "R$ 1,0000"}</small><${tipoAcao} id="enviar-${n}" ${tipoAcao === "a" ? 'href="#"' : 'type="button"'}>${concatenado ? "<span>Enviar</span><span>lance</span>" : "Enviar lance"}</${tipoAcao}></div>
    </div>`;
    return `<section class="br-card"><div class="row" ${item.atributo ? `data-numero-item="${item.atributo}"` : ""}>
      <div class="col-sm-6 cabecalho-item"><div><span class="numero-item">${n}</span><span>${n === 1 ? "TOALHA MESA" : "RESISTÊNCIA ELÉTRICA"}</span></div><div>&lt; apelido &gt;</div><div>${item.fase || "Fase de lances aberta"}</div>${criterio ? `<div>${criterio}</div>` : ""}</div>
      ${formulario()}${duplicarForm ? formulario() : ""}
      <div class="col-sm-2"><button class="favorito" type="button">Favoritos</button><input name="quantidade" value="10" type="number"></div>
    </div></section>`;
  };
  return `<!doctype html><html><body><h1>Enviar lance</h1><p>Dispensa Eletrônica Nº 53/2026 (Lei 14.133/2021)</p><p>UASG 781402</p><div class="lista-itens">${itens.map(linha).join("")}</div></body></html>`;
}

function ambiente(opcoes = {}, { confirmar = false, pisos = {} } = {}) {
  const confirmacoes = [];
  const lances = [];
  const chamadas = [];
  let resolverEnvio;
  const envio = new Promise((resolve) => { resolverEnvio = resolve; });
  const itens = opcoes.itens || [{ numero: 1 }];
  const { window, enviar } = montarPagina(paginaEmColunas(opcoes), {
    preparar: (w) => {
      w.confirm = (mensagem) => { confirmacoes.push(mensagem); return confirmar; };
      w.document.querySelectorAll('[id^="enviar-"]').forEach((botao) => {
        botao.addEventListener("click", (evento) => {
          evento.preventDefault();
          const n = botao.id.replace("enviar-", "");
          const valor = w.document.getElementById(`novo-${n}`).value;
          const lance = { numero: n, valor };
          lances.push(lance);
          w.document.getElementById(`meu-${n}`).textContent = `R$ ${valor}`;
          w.document.getElementById(`melhor-${n}`).textContent = `R$ ${valor}`;
          resolverEnvio(lance);
        });
      });
    },
  });
  window.__armazenamento.apiUrl = "https://app.exemplo.com";
  const proposta = { id: 7, numeroDispensa: "78140206000532026", uasg: "781402", totalItens: itens.length, itensPreenchidos: itens.length };
  window.fetch = async (url) => {
    chamadas.push(String(url));
    if (String(url).endsWith("/script")) return { ok: true, status: 200, json: async () => ({ proposta }) };
    if (String(url).endsWith("/itens")) return { ok: true, status: 200, json: async () => itens.map((item) => ({ numeroItem: item.numero, valorMinimo: pisos[item.numero] || "91.9000" })) };
    return { ok: true, status: 200, json: async () => [proposta] };
  };
  return { window, enviar, confirmacoes, lances, chamadas, envio };
}

for (const concatenado of [false, true]) {
  test(`associa as colunas do item e lê os preços sem data-item (rótulos concatenados: ${concatenado})`, async (t) => {
    const env = ambiente({ concatenado, itens: [{ numero: 1 }, { numero: 3, melhor: "197,0000", meu: "200,0000" }] });
    t.after(() => env.window.close());
    const resultado = await env.enviar({ action: "disputa_start", propostaId: "7" });
    assert.equal(resultado.canceled, true, resultado.error);
    assert.equal(env.confirmacoes.length, 1);
    assert.match(env.confirmacoes[0], /Item 1:.*R\$ 126,0000/);
    assert.match(env.confirmacoes[0], /Item 3:.*R\$ 196,0000/);
    assert.deepEqual(env.lances, []);
    assert.equal(env.window.document.getElementById("novo-1").value, "");
    assert.equal(env.window.document.getElementById("novo-3").value, "");
  });
}

test("preenche apenas o Novo lance da coluna certa, sem tocar quantidade ou Favoritos", { timeout: 10000 }, async (t) => {
  const env = ambiente({}, { confirmar: true });
  t.after(() => env.window.close());
  let favoritos = 0;
  env.window.document.querySelector(".favorito").addEventListener("click", () => { favoritos += 1; });
  const resultado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(resultado.ok, true, resultado.error);
  assert.deepEqual(await env.envio, { numero: "1", valor: "126,0000" });
  assert.equal(env.window.document.querySelector('[name="quantidade"]').value, "10");
  assert.equal(favoritos, 0);
  assert.equal(env.lances.length, 1);
  await env.enviar({ action: "disputa_stop" });
});

test("o piso pertence ao item da esquerda, não à posição da coluna ou da lista", { timeout: 10000 }, async (t) => {
  const env = ambiente({ itens: [{ numero: 1 }, { numero: 3, melhor: "197,0000", meu: "200,0000" }] }, { confirmar: true, pisos: { 1: "126.5000", 3: "138.7500" } });
  t.after(() => env.window.close());
  const resultado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(resultado.ok, true, resultado.error);
  assert.deepEqual(await env.envio, { numero: "3", valor: "196,0000" });
  assert.equal(env.window.document.getElementById("novo-1").value, "");
  assert.ok((await env.enviar({ action: "disputa_status" })).itensNoPiso.includes("1"));
  await env.enviar({ action: "disputa_stop" });
});

test("o layout em colunas preserva o intervalo percentual sobre preços em R$", { timeout: 10000 }, async (t) => {
  const env = ambiente({ itens: [{ numero: 1, melhor: "0,1700", meu: "0,2000", intervalo: "1,0000%" }] }, { confirmar: true, pisos: { 1: "0.1000" } });
  t.after(() => env.window.close());
  assert.equal((await env.enviar({ action: "disputa_start", propostaId: "7" })).ok, true);
  assert.deepEqual(await env.envio, { numero: "1", valor: "0,1683" });
  await env.enviar({ action: "disputa_stop" });
});

for (const [nome, opcoes] of [
  ["dois formulários na mesma linha", { duplicarForm: true }],
  ["número do cabeçalho conflitante com atributo", { itens: [{ numero: 1, atributo: "3" }] }],
  ["duas entradas sem associação segura", { entradaAmbigua: true }],
  ["valores de lance em percentual, não preço", { itens: [{ numero: 1, moeda: false }] }],
  ["campo de desconto percentual", { entradaPercentual: true }],
  ["critério de maior desconto", { criterio: "Critério de julgamento: Maior desconto" }],
  ["fase de lances encerrada", { itens: [{ numero: 1, fase: "Fase de lances encerrada" }] }],
]) {
  test(`não preenche nem envia com ${nome}`, async (t) => {
    const env = ambiente(opcoes, { confirmar: true });
    t.after(() => env.window.close());
    const resultado = await env.enviar({ action: "disputa_start", propostaId: "7" });
    assert.equal(resultado.ok, false);
    assert.equal(env.confirmacoes.length, 0);
    assert.deepEqual(env.lances, []);
    for (const input of env.window.document.querySelectorAll('[id^="novo-"]')) assert.equal(input.value, "");
  });
}

test("o diagnóstico dos campos é somente leitura e não consulta a API nem pede confirmação", { timeout: 5000 }, async (t) => {
  const env = ambiente({ itens: [{ numero: 1 }, { numero: 3, melhor: "197,0000", meu: "200,0000" }] });
  t.after(() => env.window.close());
  const resultado = await env.enviar({ action: "disputa_diagnosticar" });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.diagnostico.somenteLeitura, true);
  assert.equal(resultado.diagnostico.controlesHabilitados, 2);
  assert.deepEqual(Array.from(resultado.diagnostico.itens, (item) => item.numeroItem), ["1", "3"]);
  assert.equal(resultado.diagnostico.itens[0].melhor, "R$ 127,0000");
  assert.equal(resultado.diagnostico.itens[0].campoEncontrado, true);
  assert.equal(resultado.diagnostico.itens[0].faseAberta, true);
  assert.ok(JSON.stringify(resultado.diagnostico).length < 12000);
  assert.deepEqual(env.chamadas, []);
  assert.deepEqual(env.confirmacoes, []);
  assert.deepEqual(env.lances, []);
  assert.equal((await env.enviar({ action: "disputa_status" })).ativo, false);
});

test("o diagnóstico relata um texto de ação não interativo sem habilitar seu clique", { timeout: 5000 }, async (t) => {
  const env = ambiente({ tipoAcao: "span" });
  t.after(() => env.window.close());
  const resultado = await env.enviar({ action: "disputa_diagnosticar" });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.diagnostico.controlesHabilitados, 0);
  assert.ok(resultado.diagnostico.textosDeAcao.some((acao) => acao.tag === "SPAN"));
  assert.deepEqual(env.lances, []);
  assert.equal(env.window.document.getElementById("novo-1").value, "");
});

test("a ordem DOM das colunas não muda o número do item", async (t) => {
  const env = ambiente();
  t.after(() => env.window.close());
  const linha = env.window.document.querySelector(".row");
  linha.prepend(linha.querySelector(".formulario-lance"));
  const resultado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(resultado.canceled, true, resultado.error);
  assert.match(env.confirmacoes[0], /Item 1:.*R\$ 126,0000/);
  assert.deepEqual(env.lances, []);
});

test("data-item na coluna de preços não faz perder a fase visível no cabeçalho", async (t) => {
  const env = ambiente();
  t.after(() => env.window.close());
  env.window.document.querySelector(".formulario-lance").setAttribute("data-item", "1");
  const resultado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(resultado.canceled, true, resultado.error);
  assert.match(env.confirmacoes[0], /Item 1:.*R\$ 126,0000/);
});

test("data-item conflitante na coluna não substitui o número visível da linha", async (t) => {
  const env = ambiente();
  t.after(() => env.window.close());
  env.window.document.querySelector(".formulario-lance").setAttribute("data-item", "3");
  const resultado = await env.enviar({ action: "disputa_diagnosticar" });
  assert.equal(resultado.diagnostico.itens.length, 0);
  assert.equal(resultado.diagnostico.ambiguos, 1);
  assert.ok(resultado.diagnostico.textosDeAcao.some((acao) => acao.ancestrais.some((a) => a.atributosNumericos["data-item"] === "3")));
  assert.deepEqual(env.lances, []);
});

test("dois cartões visíveis com o mesmo número não são escolhidos arbitrariamente", async (t) => {
  const env = ambiente({ itens: [{ numero: 1 }, { numero: 1 }] });
  t.after(() => env.window.close());
  const resultado = await env.enviar({ action: "disputa_diagnosticar" });
  assert.deepEqual(Array.from(resultado.diagnostico.itensDuplicados), ["1"]);
  assert.equal(resultado.diagnostico.itens.length, 0);
  assert.deepEqual(env.chamadas, []);
  assert.deepEqual(env.lances, []);
});

test("preço com casas decimais em spans separados é lido inteiro, nunca truncado", async (t) => {
  const env = ambiente();
  t.after(() => env.window.close());
  env.window.document.getElementById("melhor-1").innerHTML = '<span>R$ 127</span><span>,</span><span>5000</span>';
  const resultado = await env.enviar({ action: "disputa_diagnosticar" });
  assert.equal(resultado.diagnostico.itens[0].melhor, "R$ 127,5000");
  assert.deepEqual(env.lances, []);
});

test("o conteúdo de outro input nunca é confundido com o nome Novo lance", { timeout: 10000 }, async (t) => {
  const env = ambiente({}, { confirmar: true });
  t.after(() => env.window.close());
  const outro = env.window.document.createElement("input");
  outro.name = "meta";
  outro.value = "Novo lance";
  env.window.document.querySelector(".formulario-lance").append(outro);
  assert.equal((await env.enviar({ action: "disputa_start", propostaId: "7" })).ok, true);
  assert.deepEqual(await env.envio, { numero: "1", valor: "126,0000" });
  assert.equal(outro.value, "Novo lance");
  await env.enviar({ action: "disputa_stop" });
});

test("o diagnóstico reconhece o campo com Enviar inicialmente desabilitado, sem preenchê-lo", async (t) => {
  const env = ambiente({ tipoAcao: "button" });
  t.after(() => env.window.close());
  env.window.document.getElementById("enviar-1").disabled = true;
  const resultado = await env.enviar({ action: "disputa_diagnosticar" });
  assert.equal(resultado.diagnostico.controlesHabilitados, 0);
  assert.equal(resultado.diagnostico.itens[0].numeroItem, "1");
  assert.equal(resultado.diagnostico.itens[0].campoEncontrado, true);
  assert.equal(resultado.diagnostico.itens[0].enviarHabilitado, false);
  assert.equal(env.window.document.getElementById("novo-1").value, "");
  assert.deepEqual(env.chamadas, []);
  assert.deepEqual(env.lances, []);
});

test("pode preencher após autorização, mas só clica quando o próprio portal habilita Enviar", { timeout: 10000 }, async (t) => {
  const env = ambiente({ tipoAcao: "button" }, { confirmar: true });
  t.after(() => env.window.close());
  const botao = env.window.document.getElementById("enviar-1");
  botao.disabled = true;
  env.window.document.getElementById("novo-1").addEventListener("input", (evento) => {
    botao.disabled = evento.target.value !== "126,0000";
  });
  assert.equal((await env.enviar({ action: "disputa_start", propostaId: "7" })).ok, true);
  assert.deepEqual(await env.envio, { numero: "1", valor: "126,0000" });
  assert.equal(botao.disabled, false);
  assert.equal(env.lances.length, 1);
  await env.enviar({ action: "disputa_stop" });
});

test("o diagnóstico recusa automação ativa e não dá a entender que ela foi parada", async (t) => {
  const env = ambiente({}, { confirmar: true });
  t.after(() => env.window.close());
  assert.equal((await env.enviar({ action: "disputa_start", propostaId: "7" })).ok, true);
  const resultado = await env.enviar({ action: "disputa_diagnosticar" });
  assert.equal(resultado.ok, false);
  assert.match(resultado.error, /Pare a automação/);
  assert.equal((await env.enviar({ action: "disputa_status" })).ativo, true);
  await env.enviar({ action: "disputa_stop" });
});

test("não clica num Enviar que continua bloqueado e os outros itens podem continuar", { timeout: 15000 }, async (t) => {
  const env = ambiente({ tipoAcao: "button", itens: [{ numero: 1 }, { numero: 3, melhor: "197,0000", meu: "200,0000" }] }, { confirmar: true });
  t.after(() => env.window.close());
  const bloqueado = env.window.document.getElementById("enviar-1");
  bloqueado.disabled = true;
  assert.equal((await env.enviar({ action: "disputa_start", propostaId: "7" })).ok, true);
  assert.deepEqual(await env.envio, { numero: "3", valor: "196,0000" });
  assert.equal(bloqueado.disabled, true);
  assert.equal(env.window.document.getElementById("novo-1").value, "");
  assert.deepEqual(env.lances, [{ numero: "3", valor: "196,0000" }]);
  await env.enviar({ action: "disputa_stop" });
});

test("a releitura antes do clique bloqueia a troca do número do item durante a digitação", { timeout: 10000 }, async (t) => {
  const env = ambiente({}, { confirmar: true });
  t.after(() => env.window.close());
  let resolverBloqueio;
  const bloqueio = new Promise((resolve) => { resolverBloqueio = resolve; });
  const enviarOriginal = env.window.chrome.runtime.sendMessage;
  env.window.chrome.runtime.sendMessage = (msg, ...args) => {
    if (msg.action !== "disputa_progress") return enviarOriginal(msg, ...args);
    if (/não passaram na releitura/.test(msg.status)) resolverBloqueio(msg.status);
    return Promise.resolve({ ok: true });
  };
  env.window.document.getElementById("novo-1").addEventListener("input", () => {
    env.window.document.querySelector(".numero-item").textContent = "3";
  }, { once: true });
  assert.equal((await env.enviar({ action: "disputa_start", propostaId: "7" })).ok, true);
  assert.match(await bloqueio, /lance não enviado/);
  assert.deepEqual(env.lances, []);
  assert.equal(env.window.document.getElementById("novo-1").value, "");
  await env.enviar({ action: "disputa_stop" });
});
