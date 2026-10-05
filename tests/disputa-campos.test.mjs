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

test("maior desconto fora do cartão também impede interpretar valores em R$ como lance em preço", async (t) => {
  const env = ambiente({}, { confirmar: true });
  t.after(() => env.window.close());
  const criterio = env.window.document.createElement("p");
  criterio.textContent = "Critério de julgamento: Maior desconto";
  env.window.document.querySelector("h1").after(criterio);
  const diagnostico = await env.enviar({ action: "disputa_diagnosticar" });
  assert.equal(diagnostico.diagnostico.itens[0].criterioPreco, false);
  assert.equal(diagnostico.diagnostico.itens[0].campoEncontrado, false);
  assert.deepEqual(env.chamadas, []);
  const resultado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(resultado.ok, false);
  assert.equal(env.confirmacoes.length, 0);
  assert.deepEqual(env.lances, []);
  assert.equal(env.window.document.getElementById("novo-1").value, "");
});

test("a releitura bloqueia um critério conflitante que apareça fora do cartão durante a digitação", { timeout: 10000 }, async (t) => {
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
    const criterio = env.window.document.createElement("p");
    criterio.textContent = "Critério de julgamento: Maior desconto";
    env.window.document.querySelector("h1").after(criterio);
  }, { once: true });
  assert.equal((await env.enviar({ action: "disputa_start", propostaId: "7" })).ok, true);
  assert.match(await bloqueio, /lance não enviado/);
  assert.deepEqual(env.lances, []);
  assert.equal(env.window.document.getElementById("novo-1").value, "");
  await env.enviar({ action: "disputa_stop" });
});

for (const [nome, trocar] of [
  ["compra", (doc) => { doc.querySelector("h1 + p").textContent = "Dispensa Eletrônica Nº 54/2026 (Lei 14.133/2021)"; }],
  ["UASG", (doc) => { doc.querySelector("h1 + p + p").textContent = "UASG 781403"; }],
]) {
  test(`não envia se a ${nome} mudar durante a digitação, mesmo mantendo a linha e os controles`, { timeout: 10000 }, async (t) => {
    const env = ambiente({}, { confirmar: true });
    t.after(() => env.window.close());
    let resolverParada;
    const parada = new Promise((resolve) => { resolverParada = resolve; });
    const enviarOriginal = env.window.chrome.runtime.sendMessage;
    env.window.chrome.runtime.sendMessage = (msg, ...args) => {
      if (msg.action !== "disputa_progress") return enviarOriginal(msg, ...args);
      if (/compra ou UASG mudou durante/.test(msg.status)) resolverParada(msg.status);
      return Promise.resolve({ ok: true });
    };
    env.window.document.getElementById("novo-1").addEventListener("input", () => trocar(env.window.document), { once: true });
    assert.equal((await env.enviar({ action: "disputa_start", propostaId: "7" })).ok, true);
    assert.match(await parada, /não foi enviada/);
    assert.deepEqual(env.lances, []);
    assert.equal((await env.enviar({ action: "disputa_status" })).ativo, false);
    assert.equal(env.window.document.getElementById("novo-1").value, "");
  });
}

test("Parar e reiniciar com piso maior não deixa uma preparação antiga enviar abaixo do novo limite", { timeout: 10000 }, async (t) => {
  const pisos = { 1: "91.9000" };
  const env = ambiente({}, { confirmar: true, pisos });
  t.after(() => env.window.close());
  let resolverReinicio;
  const reinicio = new Promise((resolve) => { resolverReinicio = resolve; });
  env.window.document.getElementById("novo-1").addEventListener("input", async () => {
    await env.enviar({ action: "disputa_stop" });
    pisos[1] = "126.5000";
    resolverReinicio(await env.enviar({ action: "disputa_start", propostaId: "7" }));
  }, { once: true });
  assert.equal((await env.enviar({ action: "disputa_start", propostaId: "7" })).ok, true);
  const resultado = await reinicio;
  assert.equal(resultado.ok, true, resultado.error);
  // Espera a preparação já em andamento terminar e o novo monitoramento observar o piso.
  await new Promise((resolve) => setTimeout(resolve, 4000));
  assert.equal(env.confirmacoes.length, 2);
  assert.deepEqual(env.lances, []);
  assert.equal(env.window.document.getElementById("novo-1").value, "");
  assert.ok((await env.enviar({ action: "disputa_status" })).itensNoPiso.includes("1"));
  await env.enviar({ action: "disputa_stop" });
});

// Regressões da leitura: a associação do item pode estar correta e ainda assim
// os preços falharem por decoração/acessibilidade da interface.
for (const decoracao of ["links", "aria-hidden", "somente-leitor-tela", "ordem-diferente"]) {
  test(`lê preços unitários da região do rótulo com ${decoracao}, sem usar números de outras regiões`, async (t) => {
    const env = ambiente();
    t.after(() => env.window.close());
    const doc = env.window.document;
    if (decoracao === "links") {
      doc.getElementById("melhor-1").innerHTML = '<span>R$ 127,0000</span><a href="#">Ver lances</a>';
      doc.getElementById("meu-1").innerHTML = '<span>R$ 130,0000</span><a href="#">Detalhes</a>';
    } else if (decoracao === "aria-hidden") {
      doc.getElementById("melhor-1").innerHTML = '<span aria-hidden="true">R$</span><span>127,0000</span>';
      doc.getElementById("meu-1").innerHTML = '<span aria-hidden="true">R$</span><span>130,0000</span>';
    } else if (decoracao === "somente-leitor-tela") {
      doc.getElementById("melhor-1").innerHTML = '<span aria-hidden="true">R$ 127,0000</span><span class="sr-only">R$ 999,0000</span>';
      doc.getElementById("meu-1").innerHTML = '<span aria-hidden="true">R$ 130,0000</span><span class="p-sr-only">R$ 999,0000</span>';
    } else {
      const formulario = doc.querySelector(".formulario-lance");
      formulario.prepend(doc.getElementById("meu-1").parentElement);
    }
    const resultado = await env.enviar({ action: "disputa_diagnosticar" });
    assert.equal(resultado.diagnostico.itens[0].melhor, "R$ 127,0000");
    assert.equal(resultado.diagnostico.itens[0].meu, "R$ 130,0000");
    assert.equal(resultado.diagnostico.itens[0].criterioPreco, true);
    assert.equal(resultado.diagnostico.itens[0].campoEncontrado, true);
    assert.deepEqual(env.chamadas, []);
    assert.deepEqual(env.lances, []);
  });
}

for (const [nome, trecho] of [
  ["duas moedas monetárias na mesma região", "R$ 127,0000 e R$ 126,0000"],
  ["valor sem unidade explícita", "127,0000"],
  ["um total em vez do valor unitário", "Total R$ 127,0000"],
  ["unidades de preço e desconto contraditórias", "R$ 127,0000 / 12,0000%"],
  ["número monetário truncável", "R$ 127, 50abc"],
]) {
  test(`a leitura de preço não autoriza envio com ${nome}`, async (t) => {
    const env = ambiente({}, { confirmar: true });
    t.after(() => env.window.close());
    env.window.document.getElementById("melhor-1").textContent = trecho;
    const resultado = await env.enviar({ action: "disputa_start", propostaId: "7" });
    assert.equal(resultado.ok, false);
    assert.equal(env.confirmacoes.length, 0);
    assert.deepEqual(env.lances, []);
    assert.equal(env.window.document.getElementById("novo-1").value, "");
  });
}

test("critério explícito de menor preço não é confundido com ajuda genérica sobre maior desconto", async (t) => {
  const env = ambiente();
  t.after(() => env.window.close());
  const doc = env.window.document;
  const criterio = doc.createElement("p");
  criterio.textContent = "Critério de julgamento: Menor preço";
  doc.querySelector("h1").after(criterio);
  const ajuda = doc.createElement("aside");
  ajuda.textContent = "Ajuda: outras compras podem usar maior desconto.";
  doc.body.append(ajuda);
  const resultado = await env.enviar({ action: "disputa_diagnosticar" });
  assert.equal(resultado.diagnostico.itens[0].criterioPreco, true);
  assert.equal(resultado.diagnostico.itens[0].melhor, "R$ 127,0000");
  assert.deepEqual(env.chamadas, []);
  assert.deepEqual(env.lances, []);
});

test("o diagnóstico distingue motivo de critério e motivo de preço, sem esconder o campo associado", async (t) => {
  const env = ambiente();
  t.after(() => env.window.close());
  env.window.document.getElementById("melhor-1").textContent = "127,0000";
  const resultado = await env.enviar({ action: "disputa_diagnosticar" });
  const item = resultado.diagnostico.itens[0];
  assert.equal(item.criterioPreco, false);
  assert.equal(item.campoAssociado, true);
  assert.equal(item.leitura.melhor.motivo, "moeda_ausente");
  assert.equal(item.leitura.meu.motivo, "ok");
  assert.equal(item.leitura.intervalo.motivo, "ok");
  assert.equal(resultado.diagnostico.criterioPagina.bloqueado, false);
  assert.deepEqual(env.chamadas, []);
  assert.deepEqual(env.lances, []);
});

for (const [nome, texto] of [
  ["menor preço e maior desconto explícitos ao mesmo tempo", "Critério de julgamento: Menor preço"],
  ["menor preço citado apenas num exemplo", "Exemplo: Critério de julgamento: Menor preço"],
]) {
  test(`não relativiza um maior desconto atual com ${nome}`, async (t) => {
    const env = ambiente({}, { confirmar: true });
    t.after(() => env.window.close());
    const doc = env.window.document;
    const explicacao = doc.createElement("p");
    explicacao.textContent = texto;
    doc.querySelector("h1").after(explicacao);
    const criterio = doc.createElement("p");
    criterio.textContent = "Critério de julgamento: Maior desconto";
    doc.querySelector("h1").after(criterio);
    const resultado = await env.enviar({ action: "disputa_start", propostaId: "7" });
    assert.equal(resultado.ok, false);
    assert.equal(env.confirmacoes.length, 0);
    assert.deepEqual(env.lances, []);
  });
}

test("uma menção não explicada fora da ajuda continua ambígua mesmo com menor preço escrito", async (t) => {
  const env = ambiente();
  t.after(() => env.window.close());
  const doc = env.window.document;
  for (const texto of ["Critério de julgamento: Menor preço", "Modo da compra: maior desconto"]) {
    const p = doc.createElement("p");
    p.textContent = texto;
    doc.querySelector("h1").after(p);
  }
  const resultado = await env.enviar({ action: "disputa_diagnosticar" });
  assert.equal(resultado.diagnostico.criterioPagina.bloqueado, true);
  assert.equal(resultado.diagnostico.itens[0].campoAssociado, true);
  assert.equal(resultado.diagnostico.itens[0].motivoBloqueio, "criterio_pagina");
  assert.equal(resultado.diagnostico.itens[0].leitura.melhor.valor, "R$ 127,0000");
  assert.equal(resultado.diagnostico.itens[0].criterioPreco, false);
  assert.deepEqual(env.chamadas, []);
  assert.deepEqual(env.lances, []);
});

for (const [nome, estilo] of [
  ["clip com área zero", "position:absolute;clip:rect(0px,0px,0px,0px);width:1px;height:1px;overflow:hidden"],
  ["clip-path integral", "clip-path:inset(50%)"],
]) {
  test(`não usa dinheiro visualmente oculto por ${nome}`, async (t) => {
    const env = ambiente();
    t.after(() => env.window.close());
    env.window.document.getElementById("melhor-1").innerHTML = `<span>R$ 127,0000</span><span style="${estilo}">R$ 999,0000</span>`;
    const resultado = await env.enviar({ action: "disputa_diagnosticar" });
    assert.equal(resultado.diagnostico.itens[0].melhor, "R$ 127,0000");
    assert.deepEqual(env.chamadas, []);
    assert.deepEqual(env.lances, []);
  });
}

test("11 itens com moeda decorativa: o diagnóstico mostra as leituras e prioriza ações reais em vez do título", async (t) => {
  const numeros = [1, 3, 6, 7, 10, 11, 12, 14, 15, 16, 17];
  const env = ambiente({ itens: numeros.map((numero) => ({ numero })) });
  t.after(() => env.window.close());
  const doc = env.window.document;
  const cabecalho = doc.createElement("app-cabecalho-compra");
  cabecalho.innerHTML = '<div class="breadcrumb-compra"><span>Enviar lance</span></div><div><p class="titulo">Enviar lance</p></div>';
  doc.body.prepend(cabecalho);
  doc.querySelectorAll(".formulario-lance").forEach((el) => el.classList.add("cp-texto-item", "cp-valor-responsivo"));
  for (const n of numeros) {
    doc.getElementById(`melhor-${n}`).innerHTML = '<span aria-hidden="true">R$ 127,0000</span><a href="#">Ver lances</a>';
    doc.getElementById(`meu-${n}`).innerHTML = '<span aria-hidden="true">R$ 130,0000</span>';
  }
  const resultado = await env.enviar({ action: "disputa_diagnosticar" });
  assert.equal(resultado.diagnostico.itens.length, 11);
  assert.equal(resultado.diagnostico.controlesHabilitados, 11);
  assert.equal(resultado.diagnostico.ambiguos, 0);
  assert.ok(resultado.diagnostico.itens.every((item) => item.criterioPreco && item.campoAssociado && item.leitura.melhor.motivo === "ok"));
  assert.ok(resultado.diagnostico.textosDeAcao.every((acao) => acao.reconhecido));
  assert.deepEqual(env.chamadas, []);
  assert.deepEqual(env.confirmacoes, []);
  assert.deepEqual(env.lances, []);
});

test("a leitura decorativa continua preenchendo somente o lance calculado e nunca clica Ver lances", { timeout: 10000 }, async (t) => {
  const env = ambiente({}, { confirmar: true });
  t.after(() => env.window.close());
  env.window.document.getElementById("melhor-1").innerHTML = '<span aria-hidden="true">R$ 127,0000</span><a id="ver-lances" href="#">Ver lances</a>';
  let clicouInformacao = 0;
  env.window.document.getElementById("ver-lances").addEventListener("click", () => { clicouInformacao += 1; });
  const resultado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(resultado.ok, true, resultado.error);
  assert.deepEqual(await env.envio, { numero: "1", valor: "126,0000" });
  assert.equal(clicouInformacao, 0);
  await env.enviar({ action: "disputa_stop" });
});

for (const intervalo of ["R$ 1,0000 (valor)", "1,0000% (diferença mínima)"]) {
  test(`intervalo explicitamente único pode ter texto auxiliar: ${intervalo}`, async (t) => {
    const env = ambiente({ itens: [{ numero: 1, intervalo }] });
    t.after(() => env.window.close());
    const resultado = await env.enviar({ action: "disputa_diagnosticar" });
    assert.equal(resultado.diagnostico.itens[0].leitura.intervalo.motivo, "ok");
    assert.deepEqual(env.chamadas, []);
    assert.deepEqual(env.lances, []);
  });
}

for (const intervalo of ["R$ 1,0000 e 1,0000%", "R$ 1,0000 ou R$ 2,0000", "0,0000%", "R$ 0,0000"]) {
  test(`não autoriza um intervalo contraditório, múltiplo ou zero: ${intervalo}`, async (t) => {
    const env = ambiente({ itens: [{ numero: 1, intervalo }] }, { confirmar: true });
    t.after(() => env.window.close());
    const resultado = await env.enviar({ action: "disputa_start", propostaId: "7" });
    assert.equal(resultado.ok, false);
    assert.equal(env.confirmacoes.length, 0);
    assert.deepEqual(env.lances, []);
  });
}

test("preço sem moeda não toma emprestado o Meu valor que está antes de seu próprio rótulo", async (t) => {
  const env = ambiente();
  t.after(() => env.window.close());
  const doc = env.window.document;
  doc.getElementById("melhor-1").textContent = "aguardando lance";
  const meu = doc.getElementById("meu-1");
  meu.parentElement.prepend(meu);
  const resultado = await env.enviar({ action: "disputa_diagnosticar" });
  assert.equal(resultado.diagnostico.itens[0].melhor, "não identificado");
  assert.equal(resultado.diagnostico.itens[0].meu, "R$ 130,0000");
  assert.equal(resultado.diagnostico.itens[0].criterioPreco, false);
  assert.deepEqual(env.lances, []);
});

test("uma referência acessível explícita associa preço e rótulo mesmo em regiões DOM separadas", async (t) => {
  const env = ambiente();
  t.after(() => env.window.close());
  const doc = env.window.document;
  const melhor = doc.getElementById("melhor-1");
  const rotulo = melhor.previousElementSibling;
  rotulo.id = "rotulo-melhor";
  melhor.setAttribute("aria-labelledby", rotulo.id);
  doc.querySelector(".formulario-lance").append(melhor);
  const resultado = await env.enviar({ action: "disputa_diagnosticar" });
  assert.equal(resultado.diagnostico.itens[0].melhor, "R$ 127,0000");
  assert.equal(resultado.diagnostico.itens[0].leitura.melhor.origem, "referencia_rotulo");
  assert.deepEqual(env.chamadas, []);
  assert.deepEqual(env.lances, []);
});
