/**
 * Harness de desenvolvimento da extensão (jsdom).
 *
 * Reproduz as páginas do ComprasNet que a extensão encontra — inclusive o
 * layout do portal real (número e título em células separadas, rótulo e valor
 * em contêineres distintos, botão de coração "Adicionar aos favoritos", seta
 * "Mostrar detalhes do item") — e roda o content.js de verdade num DOM.
 *
 * Uso:  node tests/extensao-harness/harness.mjs [nome-do-teste]
 *
 * Não faz parte do `npm test` (é pesado): rode antes de mexer no content.js.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CONTENT = readFileSync(path.join(raiz, "public", "extension", "content.js"), "utf8");

/** Cria um DOM com a página dada, injeta o content.js e devolve helpers. */
export function montarPagina(html, { url = "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet/proposta", preparar } = {}) {
  const cliques = { favoritos: 0, setas: 0, todos: 0, salvos: [] };
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (erro) => {
    if (!/Not implemented/i.test(erro.message)) console.error("jsdomError:", erro.message);
  });

  const dom = new JSDOM(html, { url, runScripts: "dangerously", pretendToBeVisual: true, virtualConsole });
  const { window } = dom;

  // jsdom devolve rects 0x0 e isVisible() recusa tudo sem isso.
  window.Element.prototype.getBoundingClientRect = () => ({
    width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, x: 0, y: 0, toJSON: () => ({}),
  });

  preparar?.(window, cliques);

  let listener = null;
  window.chrome = { runtime: { onMessage: { addListener: (fn) => { listener = fn; } }, sendMessage: () => {} } };
  const tag = window.document.createElement("script");
  tag.textContent = CONTENT;
  window.document.body.appendChild(tag);

  return { window, cliques, enviar: (msg) => new Promise((resolve) => listener(msg, {}, resolve)) };
}

// ─── Páginas de teste ────────────────────────────────────────────────────────

/** Layout do portal (print do usuário), com N itens. */
export function paginaPortal({ itens = 2, seta = true, salvar = true, mostrarTodos = false } = {}) {
  if (mostrarTodos) {
    return `<!DOCTYPE html><html><body>
      <button id="mostrar-todos">Mostrar todos os itens</button>
      <button id="favoritar-todos" aria-label="Adicionar aos favoritos"><i class="fa fa-star"></i></button>
      <div class="item" data-item="1">
        <span>Item 1</span>
        <div class="resumo" style="display:none">
          <p><span class="rotulo">Quantidade Solicitada:</span> <span class="valor">4</span></p>
          <p><span class="rotulo">Valor Estimado:</span> <span class="valor">R$ 100,00</span></p>
          <p><span class="valor">PNEU 175/70 R13 ARO 13</span></p>
        </div>
      </div>
    </body></html>`;
  }

  const item = (n) => `
    <section class="item" data-item="${n}">
      <div class="cabecalho">
        <div class="numero">${n}</div>
        <div class="titulo">${n === 1 ? "FONE OUVIDO" : `ITEM ${n}`}</div>
        <div class="campos-publicados">
          <div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">${n === 1 ? 184 : 215}</span></div>
          <div class="campo"><span class="rotulo">Unidade fornecimento</span><span class="valor">Unidade</span></div>
          <div class="campo"><span class="rotulo">Valor estimado (unitário)</span><span class="valor">R$ ${n === 1 ? "44.0000" : "45.9900"}</span></div>
          <div class="campo"><span class="valor alerta">Proposta não cadastrada</span></div>
        </div>
        <div class="acoes">
          <button class="favoritar" aria-label="Adicionar aos favoritos"><svg></svg></button>
          <button class="seta" aria-label="Mostrar detalhes do item" title="Mostrar detalhes do item"><svg></svg></button>
        </div>
      </div>
      <div class="detalhes" style="display:none">
        <div class="campo"><span class="rotulo">Descrição detalhada</span>
          <span class="valor">${n === 1 ? "tipo: intra auricular, potência: 50, frequência: 20 a 20.000, conector: p2" : "capacidade memória: 16, interface: usb 3.0, tipo: pen drive"}</span></div>
        <div class="campo"><span class="rotulo">Quantidade ofertada</span><span class="valor">${n === 1 ? 184 : 215}</span></div>
        <div class="campo"><span class="rotulo">Valor unitário (R$)</span></div>
        <input id="vu${n}" class="entrada" />
        <div class="campo"><span class="rotulo">Valor total</span><span class="valor" id="total${n}">R$ 0,0000</span></div>
        <div class="campo"><span class="rotulo">Marca/Fabricante</span></div>
        <input id="mf${n}" class="entrada" placeholder="digite a marca e o fabricante" />
        <div class="campo"><span class="rotulo">Modelo/Versão</span></div>
        <input id="mv${n}" class="entrada" placeholder="digite o modelo/versão" />
        ${salvar ? `<div class="rodape"><button id="salvar${n}" class="btn btn-primary">Salvar</button></div>` : ""}
      </div>
    </section>`;

  return `<!DOCTYPE html><html><body>
    <div class="termo"><span>Termo de Aceitação</span></div>
    <h2>Itens</h2>
    <div id="lista">${Array.from({ length: itens }, (_, i) => item(i + 1)).join("\n")}</div>
    <button id="salvar-geral">Salvar</button>
  </body></html>`;
}

/** Página-armadilha: o botão de Favoritos é o que tem aria-expanded. */
export function paginaArmadilha({ comSeta = true } = {}) {
  return `<!DOCTYPE html><html><body>
    <div class="item" data-item="1">
      <div class="cabecalho">
        <div class="numero">1</div>
        <div class="titulo">CABO FLEXIVEL 2,5MM AZUL 750V</div>
        <div class="publicados">
          <div class="campo"><span class="rotulo">Quantidade Solicitada</span><span class="valor">4</span></div>
          <div class="campo"><span class="rotulo">Valor Estimado (unitário)</span><span class="valor">R$ 100,00</span></div>
        </div>
        <button class="favoritar" aria-expanded="false"><i class="fa fa-star-o"></i></button>
        ${comSeta ? '<span class="seta"><i class="fa fa-chevron-down"></i></span>' : ""}
      </div>
      <div class="detalhes" style="display:none">
        <span class="rotulo">Descrição detalhada</span>
        <span class="valor">CABO FLEXÍVEL 2,5MM AZUL 750V ANTI-CHAMA CLASSE 5</span>
      </div>
    </div>
  </body></html>`;
}

// ─── Testes ──────────────────────────────────────────────────────────────────

const testes = {};
const registrar = (nome, fn) => { testes[nome] = fn; };
let falhas = 0;
export const conferir = (condicao, mensagem) => {
  if (condicao) console.log(`✓ ${mensagem}`);
  else { console.error(`❌ ${mensagem}`); falhas += 1; }
};

/** Liga os comportamentos da página (seta abre o painel, Salvar grava, etc). */
function comportamentoDoPortal(window, cliques) {
  window.document.querySelectorAll(".seta").forEach((botao) => {
    botao.addEventListener("click", () => {
      cliques.setas += 1;
      const painel = botao.closest(".item").querySelector(".detalhes");
      painel.style.display = "block";
    });
  });
  window.document.querySelectorAll(".favoritar").forEach((botao) => {
    botao.addEventListener("click", () => { cliques.favoritos += 1; });
  });
  window.document.querySelectorAll("button[id*='salvar']").forEach((botao) => {
    if (botao.id === "salvar-geral") return;
    botao.addEventListener("click", () => {
      cliques.salvos.push(botao.id);
      const aviso = window.document.createElement("div");
      aviso.setAttribute("role", "alert");
      aviso.className = "alert alert-success";
      aviso.textContent = "Item salvo com sucesso";
      botao.closest(".item").appendChild(aviso);
    });
  });
  window.document.getElementById("salvar-geral")?.addEventListener("click", () => cliques.salvos.push("GERAL"));
}

registrar("leitura do portal", async () => {
  const { window, cliques, enviar } = montarPagina(paginaPortal(), { preparar: (w, c) => comportamentoDoPortal(w, c) });
  const r = await enviar({ action: "read_comprasnet_items", expandir: true, delay: 30 });

  conferir(r.ok === true && r.total === 2, `leu ${r?.total} itens`);
  conferir(cliques.favoritos === 0, `não clicou em Favoritos (${cliques.favoritos})`);
  conferir(cliques.setas === 2, `clicou nas 2 setas (${cliques.setas})`);
  const [i1, i2] = r.itens;
  conferir(i1.descricao === "FONE OUVIDO", `descrição do item 1 = "${i1.descricao}"`);
  conferir(i2.descricao === "ITEM 2", `descrição do item 2 = "${i2.descricao}"`);
  conferir(!JSON.stringify(r.itens).toLowerCase().includes("favorito"), "nenhum item trouxe “favorito”");
  conferir(i1.quantidade === "184" && i2.quantidade === "215", `quantidades: ${i1.quantidade} / ${i2.quantidade}`);
  conferir(i1.unidade === "Unidade", `unidade: ${i1.unidade}`);
  conferir(i1.valorEstimado === "R$ 44.0000", `valor estimado: ${i1.valorEstimado}`);
  conferir(/intra auricular/.test(i1.descricaoDetalhada), "descrição detalhada do item 1");
  conferir(window.document.querySelectorAll(".detalhes[style*='block']").length === 2, "painéis abertos");
});

registrar("armadilha do Favoritos", async () => {
  const { window, cliques, enviar } = montarPagina(paginaArmadilha(), { preparar: comportamentoDoPortal });
  const r = await enviar({ action: "read_comprasnet_items", expandir: true, delay: 30 });

  conferir(cliques.favoritos === 0, `não clicou em Favoritos (${cliques.favoritos})`);
  conferir(cliques.setas === 1, `clicou na seta real (${cliques.setas})`);
  conferir(r.expandidos === 1, `item marcado como expandido (${r.expandidos})`);
  conferir(r.itens[0].descricao === "CABO FLEXIVEL 2,5MM AZUL 750V", `descrição do cabeçalho ("${r.itens[0].descricao}")`);
  conferir(/ANTI-CHAMA/.test(r.itens[0].descricaoDetalhada), `descrição detalhada ("${r.itens[0].descricaoDetalhada}")`);
});

registrar("só Favoritos, nada é clicado", async () => {
  const { cliques, enviar } = montarPagina(paginaArmadilha({ comSeta: false }), {
    preparar: (w, c) => {
      w.document.querySelector(".favoritar").addEventListener("click", () => { c.favoritos += 1; });
    },
  });
  const r = await enviar({ action: "read_comprasnet_items", expandir: true, delay: 30 });

  conferir(cliques.favoritos === 0, `nada foi clicado (${cliques.favoritos})`);
  conferir(r.expandidos === 0 && r.total === 1, "leu o item sem expandir");
});

registrar("mostrar todos os itens", async () => {
  const { cliques, enviar } = montarPagina(paginaPortal({ mostrarTodos: true }), {
    preparar: (w, c) => {
      w.document.getElementById("mostrar-todos").addEventListener("click", () => {
        c.todos += 1;
        w.document.querySelector(".resumo").style.display = "block";
      });
      w.document.getElementById("favoritar-todos").addEventListener("click", () => { c.favoritos += 1; });
    },
  });
  const r = await enviar({ action: "read_comprasnet_items", expandir: true, delay: 30 });

  conferir(cliques.favoritos === 0, `não clicou em Favoritos (${cliques.favoritos})`);
  conferir(cliques.todos === 1 && r.expandiuTodos === true, "clicou em “Mostrar todos os itens”");
  conferir(r.total === 1 && /PNEU 175\/70 R13 ARO 13/.test(r.itens[0].descricao), `leu o item ("${r.itens[0].descricao}")`);
});

export async function rodar(nome) {
  for (const [chave, fn] of Object.entries(testes)) {
    if (nome && !chave.includes(nome)) continue;
    console.log(`\n── ${chave} ──`);
    await fn();
  }
  return falhas;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const falhou = await rodar(process.argv[2]);
  console.log(falhou ? `\n💥 ${falhou} falha(s)` : "\n🎉 Harness da extensão OK");
  process.exitCode = falhou ? 1 : 0;
}
