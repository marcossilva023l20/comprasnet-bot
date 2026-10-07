import assert from "node:assert/strict";
import test from "node:test";
import { montarPagina } from "./extensao-harness/harness.mjs";

function htmlDaDisputa(itens) {
  const linha = (item) => {
    const intervalo = item.intervalo || "1,0000";
    const textoIntervalo = String(intervalo).includes("%") ? intervalo : `R$ ${intervalo}`;
    return `<section class="cartao-item"><div class="row">
    <div class="col-sm-6 cabecalho"><div><span class="numero-item">${item.numero}</span><span>${item.descricao || `ITEM ${item.numero}`}</span></div>
      <div>Fase de lances aberta</div><div class="situacao"><i id="sinal-${item.numero}" class="fa fa-thumbs-${item.direcao === "baixo" ? "down" : "up"}" style="color:${item.cor};"></i></div>
    </div>
    <div class="col-sm-4 formulario-lance">
      <div><span>Melhor valor (unitário)</span><span id="melhor-${item.numero}">R$ ${item.melhor || "127,0000"}</span></div>
      <div><span>Meu valor (unitário)</span><span id="meu-${item.numero}">R$ ${item.meu || "130,0000"}</span></div>
      <div><span>Novo lance (unitário)</span><input id="novo-${item.numero}" type="text" value="${item.entrada ?? ""}" aria-label="Novo lance"></div>
      <div><small>Intervalo mínimo entre lances: ${textoIntervalo}</small></div>
      <button id="enviar-${item.numero}" type="button">Enviar lance</button>
    </div>
  </div></section>`;
  };
  return `<!doctype html><html><body>
    <h1>Enviar lance</h1>
    <p>Dispensa Eletrônica Nº 53/2026 (Lei 14.133/2021)</p><p>UASG 781402</p>
    <main>${itens.map(linha).join("")}</main>
  </body></html>`;
}

function htmlDaDisputaCnetResponsiva({ colunasSeparadas = false } = {}) {
  const precos = colunasSeparadas
    ? `<div class="rotulos-preco"><span>Melhor valor (unitário)</span><span>Meu valor (unitário)</span></div>
       <div class="valores-preco"><span id="melhor-1">R$ 499,0000</span><span id="meu-1">R$ 500,0000</span></div>`
    : `<span>Melhor valor (unitário)</span><span id="melhor-1">R$ 499,0000</span>
       <span>Meu valor (unitário)</span><span id="meu-1">R$ 500,0000</span>`;
  return `<!doctype html><html><body>
    <h1>Enviar lance</h1>
    <p>Dispensa Eletrônica Nº 135/2026 (Lei 14.133/2021)</p><p>UASG 929214</p>
    <div class="width-100 cp-itens-disputa p-1 justify-content-around ng-tns-c2064260805-31 ng-trigger ng-trigger-animationItem cp-item-">
      <div class="cabecalho-item"><span class="numero-item">1</span><span>ITEM 1 — VESTUÁRIO</span>
        <div>Fase de lances aberta</div><i id="sinal-1" class="fa fa-thumbs-down" style="color:rgb(220, 53, 69)"></i>
      </div>
      <div class="col-md-7 col-sm-12 col-12 row pl-1 pr-0 align-items-center ng-tns-c2064260805-31">
        <div class="content col-md-11 col-sm-9 col-12 row pr-0 mr-1 ng-tns-c2064260805-31">
          <div class="content col-md-9 col-sm-12 col-12 pr-0 ng-tns-c2064260805-31">
            <div class="cp-texto-item conteudo-div-centralizado cp-valor-responsivo ng-tns-c2064260805-31">
              ${precos}
              <span>Novo lance (unitário)</span><input id="novo-1" type="text" value="" aria-label="Novo lance">
              <small>Intervalo mínimo entre lances: R$ 0,0050</small>
              <div class="row ng-tns-c2064260805-31 ng-star-inserted"><div class="col-auto ng-tns-c2064260805-31">
                <div class="row m-0 ng-tns-c2064260805-31"><div class="ng-tns-c2064260805-31">
                  <button id="enviar-1" class="br-button p-1 ng-tns-c2064260805-31" type="button">Enviar lance</button>
                </div></div>
              </div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </body></html>`;
}

function ambiente(itens, {
  pisos = {},
  confirmar = true,
  falharItens = false,
  aoInput = null,
  aoClique = null,
  html = null,
  url = "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/disputa?compra=53-2026",
  propostaNumeroDispensa = "78140206000532026",
  propostaUasg = "781402",
} = {}) {
  const cliques = [];
  const confirmacoes = [];
  const mensagens = [];
  const requisicoes = [];
  const pisosAtuais = pisos;
  const conteudo = montarPagina(html ?? htmlDaDisputa(itens), {
    url,
    preparar: (w) => {
      w.confirm = (texto) => { confirmacoes.push(texto); return confirmar; };
      w.document.querySelectorAll('[id^="enviar-"]').forEach((botao) => botao.addEventListener("click", (evento) => {
        evento.preventDefault();
        const numero = botao.id.slice("enviar-".length);
        const valor = w.document.getElementById(`novo-${numero}`).value;
        cliques.push({ numero, valor });
        aoClique?.({ numero, valor, window: w, pisos });
        w.document.getElementById(`meu-${numero}`).textContent = `R$ ${valor}`;
        w.document.getElementById(`melhor-${numero}`).textContent = `R$ ${valor}`;
        const sinal = w.document.getElementById(`sinal-${numero}`);
        sinal.className = "fa fa-thumbs-up";
        sinal.style.color = "rgb(25, 135, 84)";
      }));
      if (aoInput) w.document.querySelectorAll('[id^="novo-"]').forEach((input) => input.addEventListener("input", (evento) => aoInput({ numero: input.id.slice("novo-".length), evento, window: w, pisos }), { once: true }));
    },
  });
  const { window, enviar } = conteudo;
  window.__armazenamento.apiUrl = "https://comprasnet-bot.vercel.app";
  window.confirm = (texto) => { confirmacoes.push(texto); return confirmar; };
  window.chrome.runtime.sendMessage = (msg, callback) => {
    if (msg?.action === "disputa_progress") {
      mensagens.push(msg);
      return Promise.resolve({ ok: true });
    }
    if (msg?.action !== "api_request") return Promise.resolve({});
    const u = new URL(msg.url);
    requisicoes.push(u.pathname);
    if (u.pathname.endsWith("/script")) return Promise.resolve({ ok: true, status: 200, dados: { proposta: { id: 7, numeroDispensa: propostaNumeroDispensa, uasg: propostaUasg } } });
    if (u.pathname.endsWith("/itens")) {
      if (falharItens) return Promise.resolve({ ok: false, status: 503, dados: null });
      return Promise.resolve({ ok: true, status: 200, dados: itens.map((item) => ({ numeroItem: item.numero, valorMinimo: pisosAtuais[item.numero] })) });
    }
    return Promise.resolve({ ok: false, status: 404, dados: null });
  };
  return { window, enviar, cliques, confirmacoes, mensagens, requisicoes, pisosAtuais };
}

async function esperar(condicao, timeoutMs = 12000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if (condicao()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(condicao(), `condição não atendida após ${timeoutMs} ms`);
}

const verde = { direcao: "cima", cor: "rgb(25, 135, 84)" };
const vermelho = { direcao: "baixo", cor: "rgb(220, 53, 69)" };
const base = (numero, situacao, resto = {}) => ({ numero, ...situacao, melhor: "127,0000", meu: "130,0000", intervalo: "1,0000", ...resto });

for (const [nome, situacao, esperado] of [
  ["polegar para baixo vermelho", vermelho, "perdendo"],
  ["polegar para cima verde", verde, "vencendo"],
  ["polegar para baixo pintado de verde (conflito)", { direcao: "baixo", cor: "rgb(25, 135, 84)" }, "indefinido"],
  ["polegar para cima pintado de vermelho (conflito)", { direcao: "cima", cor: "rgb(220, 53, 69)" }, "indefinido"],
  ["indicador cinza/ambíguo", { direcao: "baixo", cor: "rgb(90, 90, 90)" }, "indefinido"],
]) {
  test(`o diagnóstico somente leitura classifica ${nome} sem preencher nem consultar a API`, async (t) => {
    const env = ambiente([base(1, situacao)]);
    t.after(() => env.window.close());
    const resultado = await env.enviar({ action: "disputa_diagnosticar" });
    assert.equal(resultado.ok, true);
    assert.equal(resultado.diagnostico.itens[0].situacaoCompetitiva.estado, esperado);
    assert.equal(env.confirmacoes.length, 0);
    assert.deepEqual(env.cliques, []);
    assert.deepEqual(env.requisicoes, []);
    assert.equal(env.window.document.getElementById("novo-1").value, "");
  });
}

test("o diagnóstico lê os valores do CNET quando cada rótulo e preço é texto irmão na coluna responsiva", async (t) => {
  const { window, enviar } = montarPagina(htmlDaDisputaCnetResponsiva(), {
    url: "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/disputa?compra=135-2026",
  });
  t.after(() => window.close());

  const resultado = await enviar({ action: "disputa_diagnosticar" });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.diagnostico.itens.length, 1);
  const item = resultado.diagnostico.itens[0];
  assert.equal(item.numeroItem, "1");
  assert.equal(item.faseAberta, true);
  assert.equal(item.situacaoCompetitiva.estado, "perdendo");
  assert.equal(item.criterioPreco, true);
  assert.equal(item.melhor, "R$ 499,0000");
  assert.equal(item.meu, "R$ 500,0000");
  assert.equal(item.leitura.melhor.origem, "segmento_rotulado");
  assert.equal(item.leitura.meu.origem, "segmento_rotulado");
  assert.match(item.intervalo, /R\$ 0,0050/);
  assert.equal(item.motivoBloqueio, null);
  assert.equal(item.campoEncontrado, true);
  assert.equal(item.campoAssociado, true);
  assert.equal(item.campoDisponivel, true);
  assert.equal(window.document.getElementById("novo-1").value, "");
});

test("calcula melhor menos intervalo para a confirmação, mas cancelar não preenche nem clica no CNET", async (t) => {
  const env = ambiente([base(1, vermelho, { melhor: "499,0000", meu: "500,0000", intervalo: "0,0050" })], {
    html: htmlDaDisputaCnetResponsiva(),
    url: "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/disputa?compra=135-2026",
    propostaNumeroDispensa: "92921406001352026",
    propostaUasg: "929214",
    pisos: { 1: "400.0000" },
    confirmar: false,
  });
  t.after(() => env.window.close());

  const resultado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(resultado.canceled, true);
  assert.match(env.confirmacoes[0], /Dispensa 135\/2026 · UASG 929214/);
  assert.match(env.confirmacoes[0], /melhor R\$ 499,0000 − intervalo R\$ 0,0050 → lance R\$ 498,9950/);
  assert.deepEqual(env.cliques, []);
  assert.equal(env.window.document.getElementById("novo-1").value, "");
});

test("rótulos e preços em colunas sem associação estrutural continuam ambíguos e bloqueados", async (t) => {
  const { window, enviar } = montarPagina(htmlDaDisputaCnetResponsiva({ colunasSeparadas: true }), {
    url: "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/disputa?compra=135-2026",
  });
  t.after(() => window.close());

  const resultado = await enviar({ action: "disputa_diagnosticar" });
  const item = resultado.diagnostico.itens[0];
  assert.equal(item.criterioPreco, false);
  assert.equal(item.motivoBloqueio, "precos_ilegíveis");
  assert.notEqual(item.leitura.melhor.motivo, "ok");
  assert.notEqual(item.leitura.meu.motivo, "ok");
  assert.equal(item.campoEncontrado, true);
  assert.equal(item.campoAssociado, true);
  assert.equal(item.campoDisponivel, false);
  assert.equal(window.document.getElementById("novo-1").value, "");
});

test("📖 Ler página mapeia controles sem preencher, consultar a API ou enviar", async (t) => {
  const env = ambiente([base(1, vermelho)]);
  t.after(() => env.window.close());
  const resultado = await env.enviar({ action: "disputa_ler_pagina" });
  assert.equal(resultado.ok, true, resultado.error);
  assert.equal(resultado.totalCartoes, 1);
  assert.equal(resultado.camposEncontrados, 1);
  assert.equal(resultado.botoesEncontrados, 1);
  assert.match(resultado.message, /1 campo\(s\) de novo lance/);
  assert.deepEqual(env.requisicoes, []);
  assert.deepEqual(env.confirmacoes, []);
  assert.deepEqual(env.cliques, []);
  assert.equal(env.window.document.getElementById("novo-1").value, "");
});

test("a confirmação prévia descreve estado, melhor−intervalo e piso; cancelar não digita nem envia", async (t) => {
  const env = ambiente([base(1, vermelho)], { pisos: { 1: "100.0000" }, confirmar: false });
  t.after(() => env.window.close());
  const resultado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(resultado.canceled, true);
  assert.match(env.confirmacoes[0], /polegar para baixo vermelho/);
  assert.match(env.confirmacoes[0], /melhor R\$ 127,0000 − intervalo R\$ 1,0000 → lance R\$ 126,0000/);
  assert.match(env.confirmacoes[0], /mín\. R\$ 100,0000/);
  assert.equal(env.window.document.getElementById("novo-1").value, "");
  assert.deepEqual(env.cliques, []);
});

test("envia uma única vez apenas o item vermelho; itens verde e incerto não são tocados", { timeout: 15000 }, async (t) => {
  const itens = [base(1, vermelho), base(3, verde, { melhor: "197,0000", meu: "200,0000" }), base(6, { direcao: "baixo", cor: "rgb(90, 90, 90)" }, { melhor: "197,0000", meu: "200,0000" })];
  const env = ambiente(itens, { pisos: { 1: "100.0000", 3: "150.0000", 6: "150.0000" } });
  // JSDOM não oferece scrollIntoView; a falha da rolagem opcional não pode impedir o clique validado.
  env.window.document.getElementById("enviar-1").scrollIntoView = undefined;
  t.after(() => env.window.close());
  const iniciado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(iniciado.ok, true, iniciado.error);
  await esperar(() => env.cliques.length === 1, 12000);
  assert.deepEqual(env.cliques, [{ numero: "1", valor: "126,0000" }]);
  assert.equal(env.window.document.getElementById("novo-3").value, "");
  assert.equal(env.window.document.getElementById("novo-6").value, "");
  assert.equal(env.window.document.getElementById("sinal-1").className, "fa fa-thumbs-up");
  await env.enviar({ action: "disputa_stop" });
});

test("no piso próximo suspende só esse item; outro polegar vermelho ainda pode receber lance", { timeout: 15000 }, async (t) => {
  const itens = [base(1, vermelho), base(3, vermelho, { melhor: "197,0000", meu: "200,0000" })];
  const env = ambiente(itens, { pisos: { 1: "126.5000", 3: "150.0000" } });
  t.after(() => env.window.close());
  const iniciado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(iniciado.ok, true, iniciado.error);
  await esperar(() => env.cliques.length === 1, 12000);
  assert.deepEqual(env.cliques, [{ numero: "3", valor: "196,0000" }]);
  assert.ok((await env.enviar({ action: "disputa_status" })).itensNoPiso.includes("1"));
  assert.equal(env.window.document.getElementById("novo-1").value, "");
  await env.enviar({ action: "disputa_stop" });
});

test("item parado no piso só é reavaliado quando o Valor Mínimo muda no sistema", { timeout: 20000 }, async (t) => {
  const itens = [base(1, vermelho)];
  const env = ambiente(itens, { pisos: { 1: "126.5000" } });
  t.after(() => env.window.close());
  const iniciado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(iniciado.ok, true, iniciado.error);
  await esperar(() => env.mensagens.some((m) => /abaixo do Valor Mínimo/.test(m.status)), 5000);
  assert.deepEqual(env.cliques, []);
  env.pisosAtuais[1] = "125.5000";
  await esperar(() => env.cliques.length === 1, 12000);
  assert.deepEqual(env.cliques, [{ numero: "1", valor: "126,0000" }]);
  assert.ok(env.mensagens.some((m) => /Valor Mínimo alterado no sistema/.test(m.status)));
  await env.enviar({ action: "disputa_stop" });
});

test("sem piso válido a automação não pede confirmação, não digita e não envia", async (t) => {
  const env = ambiente([base(1, vermelho)], { pisos: { 1: "" } });
  t.after(() => env.window.close());
  const resultado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(resultado.ok, false);
  assert.equal(env.confirmacoes.length, 0);
  assert.deepEqual(env.cliques, []);
  assert.equal(env.window.document.getElementById("novo-1").value, "");
});

test("se não conseguir reler os pisos atuais durante o monitoramento, para sem clicar", { timeout: 12000 }, async (t) => {
  const env = ambiente([base(1, vermelho)], { pisos: { 1: "100.0000" }, falharItens: true });
  t.after(() => env.window.close());
  const resultado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(resultado.ok, false);
  assert.equal(env.confirmacoes.length, 0);
  assert.deepEqual(env.cliques, []);
  assert.equal(env.window.document.getElementById("novo-1").value, "");
});

test("a fórmula não envia se o próximo valor não melhora o Meu valor", async (t) => {
  const env = ambiente([base(1, vermelho, { melhor: "131,0000", meu: "130,0000" })], { pisos: { 1: "100.0000" } });
  t.after(() => env.window.close());
  const resultado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(resultado.ok, true, resultado.error);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(env.cliques, []);
  assert.equal(env.window.document.getElementById("novo-1").value, "");
  await env.enviar({ action: "disputa_stop" });
});

test("uma mudança do Valor Mínimo enquanto o campo é digitado bloqueia o clique e limpa a preparação", { timeout: 15000 }, async (t) => {
  const itens = [base(1, vermelho)];
  const env = ambiente(itens, { pisos: { 1: "100.0000" }, aoInput: ({ pisos }) => { pisos[1] = "126.5000"; } });
  t.after(() => env.window.close());
  const iniciado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(iniciado.ok, true, iniciado.error);
  await esperar(() => env.mensagens.some((m) => /abaixo do Valor Mínimo/.test(m.status)), 12000);
  assert.deepEqual(env.cliques, []);
  assert.equal(env.window.document.getElementById("novo-1").value, "");
  assert.ok((await env.enviar({ action: "disputa_status" })).itensNoPiso.includes("1"));
  await env.enviar({ action: "disputa_stop" });
});

test("se o piso subir depois do clique já iniciado, confirma o que ocorreu e suspende o item", { timeout: 15000 }, async (t) => {
  const itens = [base(1, vermelho)];
  const env = ambiente(itens, { pisos: { 1: "100.0000" }, aoClique: ({ pisos }) => { pisos[1] = "126.5000"; } });
  t.after(() => env.window.close());
  const iniciado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(iniciado.ok, true, iniciado.error);
  await esperar(() => env.mensagens.some((m) => /abaixo do novo mínimo|Valor Mínimo atual foi atingido/.test(m.status)), 12000);
  assert.deepEqual(env.cliques, [{ numero: "1", valor: "126,0000" }]);
  assert.ok((await env.enviar({ action: "disputa_status" })).itensNoPiso.includes("1"));
  await env.enviar({ action: "disputa_stop" });
});

test("mais de um polegar no cartão é ambíguo e bloqueia a autorização de qualquer lance", async (t) => {
  const env = ambiente([base(1, vermelho)]);
  t.after(() => env.window.close());
  const segundo = env.window.document.createElement("i");
  segundo.className = "fa fa-thumbs-up";
  segundo.style.color = "rgb(25, 135, 84)";
  env.window.document.querySelector(".cabecalho").append(segundo);
  const leitura = await env.enviar({ action: "disputa_diagnosticar" });
  assert.equal(leitura.diagnostico.itens[0].situacaoCompetitiva.estado, "indefinido");
  assert.equal(leitura.diagnostico.itens[0].situacaoCompetitiva.motivo, "indicadores_ambiguos");
  assert.deepEqual(env.requisicoes, []);
  assert.deepEqual(env.cliques, []);
  assert.equal(env.window.document.getElementById("novo-1").value, "");
});

test("se o ícone mudar de vermelho para verde durante a preparação, limpa o campo e não clica", { timeout: 12000 }, async (t) => {
  const itens = [base(1, vermelho)];
  const env = ambiente(itens, { pisos: { 1: "100.0000" }, aoInput: ({ window }) => {
    const sinal = window.document.getElementById("sinal-1");
    sinal.className = "fa fa-thumbs-up";
    sinal.style.color = "rgb(25, 135, 84)";
  } });
  t.after(() => env.window.close());
  const iniciado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(iniciado.ok, true, iniciado.error);
  await esperar(() => env.mensagens.some((m) => /perdendo \\(polegar para baixo vermelho\\)|Monitorando 1 itens/.test(m.status)), 7000);
  assert.deepEqual(env.cliques, []);
  assert.equal(env.window.document.getElementById("novo-1").value, "");
  await env.enviar({ action: "disputa_stop" });
});

test("o polegar vermelho governa uma situação de empate: melhor−intervalo precisa melhorar o Meu valor", { timeout: 15000 }, async (t) => {
  const env = ambiente([base(1, vermelho, { melhor: "130,0000", meu: "130,0000" })], { pisos: { 1: "100.0000" } });
  t.after(() => env.window.close());
  const iniciado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(iniciado.ok, true, iniciado.error);
  await esperar(() => env.cliques.length === 1, 12000);
  assert.deepEqual(env.cliques, [{ numero: "1", valor: "129,0000" }]);
  await env.enviar({ action: "disputa_stop" });
});

test("mantém a regra de intervalo percentual sobre menor preço e mostra a conversão antes da autorização", async (t) => {
  const env = ambiente([base(1, vermelho, { melhor: "0,1700", meu: "0,2000", intervalo: "1,0000%" })], { pisos: { 1: "0.1000" }, confirmar: false });
  t.after(() => env.window.close());
  const resultado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(resultado.canceled, true, JSON.stringify(resultado));
  assert.match(env.confirmacoes[0], /intervalo 1,0000% \(R\$ 0,0017\) → lance R\$ 0,1683/);
  assert.deepEqual(env.cliques, []);
  assert.equal(env.window.document.getElementById("novo-1").value, "");
});

test("se a página disser maior desconto, valores monetários não autorizam lances", async (t) => {
  const env = ambiente([base(1, vermelho)], { pisos: { 1: "100.0000" } });
  t.after(() => env.window.close());
  const criterio = env.window.document.createElement("p");
  criterio.textContent = "Critério de julgamento: Maior desconto";
  env.window.document.querySelector("h1").after(criterio);
  const resultado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(resultado.ok, false);
  assert.equal(env.confirmacoes.length, 0);
  assert.deepEqual(env.cliques, []);
  assert.equal(env.window.document.getElementById("novo-1").value, "");
});

test("uma parada antiga do Modo Proposta não bloqueia a digitação da nova sessão de Disputa", { timeout: 15000 }, async (t) => {
  const env = ambiente([base(1, vermelho)], { pisos: { 1: "100.0000" } });
  t.after(() => env.window.close());
  assert.equal((await env.enviar({ action: "stop" })).ok, true);
  const iniciado = await env.enviar({ action: "disputa_start", propostaId: "7" });
  assert.equal(iniciado.ok, true, iniciado.error);
  await esperar(() => env.cliques.length === 1, 12000);
  assert.deepEqual(env.cliques, [{ numero: "1", valor: "126,0000" }]);
  await env.enviar({ action: "disputa_stop" });
});
