/**
 * Harness do SALVAR (jsdom) — os casos em que o site preenche mas não grava:
 *  1) Salvar no rodapé do painel, fora do contêiner dos campos
 *  2) Salvar desabilitado que habilita depois
 *  3) Salvar só com ícone (id/classe, sem texto)
 *  4) Salvar dentro de shadow DOM
 *  5) Site não reage ao clique → clicado, mas não confirmado
 *  6) Sem botão Salvar → não clicado, com motivo (e não entra em savedItems)
 *  7) Máscara recusa o valor digitado → campo não preenchido é reportado
 *  8) Salvar é um submit de formulário → envia UMA vez (sem salvamento duplicado)
 *  9) Primeiro clique não pega (formulário ainda atualizando) → tenta de novo e salva
 * 10) Máscara de moeda que só aceita digitação tecla a tecla → preenche e salva
 * 11) Site pede confirmação em janela ("Salvar" → "Confirmar") → confirma e salva
 * 12) Máscara de 4 casas do portal ("44,0000") → é esse o valor que salva
 * 13) Máscara de 2 casas: escala detectada na primeira tecla, sem relançar
 * 14) Formulário tipo Angular (ng-pristine): o reforço faz o site registrar o valor
 * 15) Site recusa ("campo é obrigatório"): não conta como salvo e avisa
 * 16) Portal só contabiliza com tecla real: o Backspace do bot faz o total sair de 0,0000
 * 17) Máscara que insere na própria tecla (keydown) → os dígitos NÃO duplicam
 * 18) Valor unitário é lançado UMA vez só (não fica relançando o valor)
 * 19) Preenche na ordem do Item (1, 2, 3) e não pula item de painel devagar
 * 20) Velocidade turbo: 0,03s e o máximo (0,001s) preenchem igual e mais rápido
 * 21) Máscara ASSÍNCRONA (Angular) em velocidade máxima: sem dígito duplicado
 *     (1.232,8000 não pode virar 12.328,0000)
 * 22) Valores 1/10/100/1000/10000 mantêm quatro casas, lançam uma vez e
 *     continuam preenchendo marca/fabricante e modelo/versão
 * 23) Valor 67,4100 exato e confirmação Não/Sim sem ARIA/classes conhecidas
 * 24) Se a máscara corromper o preço, o bot não salva e continua os outros campos
 * 25) A máscara pode exibir 6,0000 primeiro; continua com o prefixo cru e salva 67,4100
 * 26) O botão Salvar do portal (br-button) é encontrado pelo nome acessível
 *
 * Uso: node tests/extensao-harness/salvar.mjs
 */
import { montarPagina, conferir } from "./harness.mjs";

function pagina({ salvar = "normal", shadow = false, reacao = true, mascara = false, itens = 2 } = {}) {
  const botao = (id) =>
    salvar === "icone"
      ? `<button id="btn-salvar" class="btn-salvar" title="Salvar"><svg></svg></button>`
      : salvar === "desabilitado"
        ? `<button id="${id}" class="btn btn-primary" disabled>Salvar</button>`
        : `<button id="${id}" class="btn btn-primary" ${reacao ? "" : 'data-reacao="nao"'}>Salvar</button>`;

  const item = (n) => `
    <section class="item" data-item="${n}">
      <div class="cabecalho">
        <div class="numero">${n}</div>
        <div class="titulo">ITEM ${n}</div>
        <div class="publicados">
          <div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">10</span></div>
          <div class="campo"><span class="rotulo">Valor estimado (unitário)</span><span class="valor">R$ 100,00</span></div>
        </div>
        <button class="favoritar" aria-label="Adicionar aos favoritos"><svg></svg></button>
        <button class="seta" title="Mostrar detalhes do item"><svg></svg></button>
      </div>
      <div class="detalhes">
        <div class="campos">
          <label>Valor unitário (R$)</label><input id="vu${n}" class="entrada" ${mascara ? 'data-mascara="1"' : ""} />
          <label>Marca/Fabricante</label><input id="mf${n}" class="entrada" />
          <label>Modelo/Versão</label><input id="mv${n}" class="entrada" />
          <div class="campo"><span class="rotulo">Valor total</span><span class="valor" id="total${n}">R$ 0,0000</span></div>
        </div>
        <div class="rodape">${salvar === "nenhum" ? "" : botao(`salvar${n}`)}</div>
      </div>
    </section>`;

  const sufixo = shadow
    ? `<script>
        const host = document.createElement("div");
        host.id = "host-shadow";
        document.body.appendChild(host);
        const raiz = host.attachShadow({ mode: "open" });
        raiz.innerHTML = '<button id="salvar-shadow" class="btn">Salvar</button><div class="toast" style="display:none">Item salvo com sucesso</div>';
        raiz.getElementById("salvar-shadow").addEventListener("click", () => {
          raiz.querySelector(".toast").style.display = "block";
        });
      </script>`
    : "";

  return `<!DOCTYPE html><html><body>
    <h2>Itens</h2>
    <div id="lista">${Array.from({ length: itens }, (_, i) => item(i + 1)).join("\n")}</div>
    ${sufixo}
  </body></html>`;
}

function ambiente(html, { mascara = false, habilitarDepois = false } = {}) {
  const eventos = { salvos: [] };
  const { window, cliques, enviar } = montarPagina(html, {
    preparar: (w, c) => {
      w.document.querySelectorAll("input.entrada").forEach((input) => {
        if (mascara && input.dataset.mascara === "1") {
          input.addEventListener("input", () => {
            if (!/^\d+(,\d+)?$/.test(input.value)) input.value = "";
          });
        }
        input.addEventListener("change", () => {
          if (habilitarDepois) {
            setTimeout(() => input.closest(".item").querySelector("button[id*='salvar']")?.removeAttribute("disabled"), 300);
          }
        });
      });
      w.document.querySelectorAll("button[id*='salvar']").forEach((botao) => {
        botao.addEventListener("click", () => {
          if (botao.disabled) return;
          eventos.salvos.push(botao.id);
          c.salvos.push(botao.id);
          if (botao.dataset.reacao === "nao") return;
          const aviso = w.document.createElement("div");
          aviso.setAttribute("role", "alert");
          aviso.className = "alert alert-success";
          aviso.textContent = "Item salvo com sucesso";
          botao.closest(".item")?.appendChild(aviso);
        });
      });
      w.document.querySelectorAll(".favoritar").forEach((b) => b.addEventListener("click", () => { c.favoritos += 1; }));
    },
  });
  return { window, cliques, eventos, enviar };
}

/** Página com a máscara de valor do portal: N casas decimais (ex.: 4 → 44,0000). */
function paginaComMascara(casas) {
  return `<!DOCTYPE html><html><body>
    <h2>Itens</h2>
    <div id="lista">
      <section class="item" data-item="1">
        <div class="cabecalho"><div class="numero">1</div><div class="titulo">ITEM 1</div>
          <div class="publicados"><div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">10</span></div></div>
          <button class="seta" title="Mostrar detalhes do item"><svg></svg></button></div>
        <div class="detalhes">
          <div class="campos">
            <label>Valor unitário (R$)</label><input id="vu1" class="entrada" data-casas="${casas}" />
            <label>Marca/Fabricante</label><input id="mf1" class="entrada" />
            <label>Modelo/Versão</label><input id="mv1" class="entrada" />
          </div>
          <div class="rodape"><button id="salvar1" class="btn btn-primary">Salvar</button></div>
        </div>
      </section>
    </div>
  </body></html>`;
}

/** Monta o ambiente com a máscara pedida e registra o que o site salvar. */
function ambienteComMascara(casas, valorEnviado) {
  const eventos = { salvos: [] };
  const { window, enviar } = montarPagina(paginaComMascara(casas), {
    preparar: (w) => {
      w.document.querySelectorAll(".seta").forEach((b) => b.addEventListener("click", () => {
        b.closest(".item").querySelector(".detalhes").style.display = "block";
      }));

      const formato = (digitos) =>
        (Number(digitos || "0") / 10 ** casas).toLocaleString("pt-BR", {
          minimumFractionDigits: casas,
          maximumFractionDigits: casas,
        });

      w.document.querySelectorAll("input[data-casas]").forEach((input) => {
        input.addEventListener("input", () => {
          input.value = formato(input.value.replace(/\D/g, ""));
        });
      });

      w.document.getElementById("salvar1").addEventListener("click", () => {
        const valor = w.document.getElementById("vu1").value;
        eventos.salvos.push(`salvar1:${valor}`);
        const aviso = w.document.createElement("div");
        aviso.setAttribute("role", "alert");
        aviso.className = "alert alert-success";
        aviso.textContent = "Item salvo com sucesso";
        w.document.querySelector(".item").appendChild(aviso);
      });
    },
  });

  const enviar1 = () =>
    enviar({
      action: "fill_items",
      delay: 20,
      items: [{ item: 1, valorUnitario: valorEnviado, marcaFabricante: "MICHELIN", modeloVersao: "PRIMACY 4" }],
    });

  return { window, eventos, enviar1 };
}

const preencher = (numeros) => ({
  action: "fill_items",
  delay: 20,
  items: numeros.map((n) => ({ item: n, valorUnitario: "1234,56", marcaFabricante: "MICHELIN", modeloVersao: "PRIMACY 4" })),
});

export async function rodarSalvar() {
  let falhas = 0;
  const checar = (c, m) => { if (!c) falhas += 1; conferir(c, m); };

  console.log("\n── 1) Salvar no rodapé do painel ──");
  {
    const { eventos, cliques, enviar } = ambiente(pagina());
    const r = await enviar(preencher([1, 2]));
    checar(r.filled === 2, `2 itens preenchidos (${r.filled})`);
    checar(JSON.stringify(eventos.salvos) === JSON.stringify(["salvar1", "salvar2"]), `clicou no Salvar de cada item (${JSON.stringify(eventos.salvos)})`);
    checar(JSON.stringify(r.savedItems) === JSON.stringify([1, 2]), `savedItems = ${JSON.stringify(r.savedItems)}`);
    checar(r.salvamentos.every((s) => s.clicado && s.confirmado), "todos confirmados");
    checar(cliques.favoritos === 0, "não clicou em Favoritos");
  }

  console.log("\n── 2) Salvar desabilitado que habilita depois ──");
  {
    const { eventos, enviar } = ambiente(pagina({ salvar: "desabilitado" }), { habilitarDepois: true });
    const r = await enviar(preencher([1]));
    checar(JSON.stringify(eventos.salvos) === JSON.stringify(["salvar1"]), `esperou habilitar e clicou (${JSON.stringify(eventos.salvos)})`);
    checar(r.salvamentos[0].confirmado === true, "salvamento confirmado");
  }

  console.log("\n── 3) Salvar só com ícone (id/classe) ──");
  {
    const { eventos, enviar } = ambiente(pagina({ salvar: "icone" }));
    const r = await enviar(preencher([1]));
    checar(eventos.salvos.length === 1 && /salvar/i.test(eventos.salvos[0]), `achou pelo id/classe e clicou (${JSON.stringify(eventos.salvos)})`);
    checar(r.salvamentos[0].clicado && r.salvamentos[0].confirmado, `relatório: clicado e confirmado (botão "${r.salvamentos[0].botao}")`);
  }

  console.log("\n── 4) Salvar dentro de shadow DOM ──");
  {
    const { window, enviar } = ambiente(pagina({ salvar: "nenhum", shadow: true }));
    const r = await enviar(preencher([1]));
    const raiz = window.document.getElementById("host-shadow").shadowRoot;
    checar(r.salvamentos[0].clicado === true, `encontrou o Salvar no shadow root ("${r.salvamentos[0].botao}")`);
    checar(r.salvamentos[0].confirmado === true, "confirmou pelo toast");
    checar(raiz.querySelector(".toast").style.display === "block", "toast exibido");
  }

  console.log("\n── 5) Site não reage ao clique ──");
  {
    const { eventos, enviar } = ambiente(pagina({ reacao: false }));
    const r = await enviar(preencher([1]));
    checar(eventos.salvos.length === 2, `clicou 2× (o site não reage) — cliques: ${eventos.salvos.length}`);
    checar(r.salvamentos[0].clicado === true && r.salvamentos[0].confirmado === false, "relatório: clicado, sem confirmação");
    checar(r.salvamentos[0].tentativas === 2, "relatório: 2 tentativas");
    checar(JSON.stringify(r.savedItems) === JSON.stringify([1]), "entra em savedItems (o clique aconteceu)");
    checar(r.warnings.some((w) => /não confirmou/.test(w)), "avisa o usuário para conferir");
    checar(r.salvamentos[0].botaoPistas?.includes("salvar1"), `diagnóstico traz o botão (${r.salvamentos[0].botaoPistas})`);
  }

  console.log("\n── 6) Sem botão Salvar nenhum ──");
  {
    const { eventos, enviar } = ambiente(pagina({ salvar: "nenhum" }));
    const r = await enviar(preencher([1]));
    checar(eventos.salvos.length === 0, "nada foi clicado");
    checar(r.salvamentos[0].clicado === false, `relatório: não clicado (${r.salvamentos[0].motivo})`);
    checar(JSON.stringify(r.savedItems) === JSON.stringify([]), "não entra em savedItems");
    checar(r.warnings.some((w) => /NÃO salvei/.test(w)), "avisa o usuário que não salvou");
  }

  console.log("\n── 7) Máscara recusa o valor digitado ──");
  {
    const { window, eventos, enviar } = ambiente(pagina({ mascara: true }), { mascara: true });
    const r = await enviar({
      action: "fill_items",
      delay: 20,
      items: [{ item: 1, valorUnitario: "mil reais", marcaFabricante: "MICHELIN", modeloVersao: "PRIMACY 4" }],
    });
    checar(window.document.getElementById("vu1").value === "", "o campo ficou vazio");
    checar(r.filled === 0 && r.errors.some((e) => /valor unitário/i.test(e)), `erro reportado: "${r.errors[0]}"`);
    checar(eventos.salvos.length === 0, "não salvou item incompleto");
  }

  console.log("\n── 8) Salvar é submit de formulário (não pode enviar 2×) ──");
  {
    const html = `<!DOCTYPE html><html><body>
      <h2>Itens</h2>
      <div id="lista">
        <section class="item" data-item="1">
          <div class="cabecalho"><div class="numero">1</div><div class="titulo">ITEM 1</div>
            <div class="publicados"><div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">10</span></div></div>
            <button class="seta" title="Mostrar detalhes do item"><svg></svg></button></div>
          <div class="detalhes">
            <form id="form1">
              <div class="campos">
                <label>Valor unitário (R$)</label><input id="vu1" class="entrada" />
                <label>Marca/Fabricante</label><input id="mf1" class="entrada" />
                <label>Modelo/Versão</label><input id="mv1" class="entrada" />
              </div>
              <div class="rodape"><button id="salvar1" type="submit" class="btn btn-primary">Salvar</button></div>
            </form>
          </div>
        </section>
      </div>
    </body></html>`;

    const contagem = { submits: 0 };
    const { window, enviar } = montarPagina(html, {
      preparar: (w) => {
        w.document.querySelectorAll(".seta").forEach((b) => b.addEventListener("click", () => {
          b.closest(".item").querySelector(".detalhes").style.display = "block";
        }));
        w.document.getElementById("form1").addEventListener("submit", (e) => {
          e.preventDefault();
          contagem.submits += 1;
          const aviso = w.document.createElement("div");
          aviso.setAttribute("role", "alert");
          aviso.className = "alert alert-success";
          aviso.textContent = "Item salvo com sucesso";
          w.document.querySelector(".item").appendChild(aviso);
        });
      },
    });

    const r = await enviar(preencher([1]));
    checar(contagem.submits === 1, `o formulário foi enviado 1 vez (enviado ${contagem.submits}×)`);
    checar(r.salvamentos[0]?.clicado === true && r.salvamentos[0]?.confirmado === true, "relatório: clicado e confirmado pelo aviso");
    checar(window.document.querySelectorAll('[role="alert"]').length === 1, "não duplicou o salvamento");
  }

  console.log("\n── 9) Primeiro clique não pega (formulário recém-preenchido) ──");
  {
    const html = `<!DOCTYPE html><html><body>
      <h2>Itens</h2>
      <div id="lista">
        <section class="item" data-item="1">
          <div class="cabecalho"><div class="numero">1</div><div class="titulo">ITEM 1</div>
            <div class="publicados"><div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">10</span></div></div>
            <button class="seta" title="Mostrar detalhes do item"><svg></svg></button></div>
          <div class="detalhes">
            <div class="campos">
              <label>Valor unitário (R$)</label><input id="vu1" class="entrada" />
              <label>Marca/Fabricante</label><input id="mf1" class="entrada" />
              <label>Modelo/Versão</label><input id="mv1" class="entrada" />
            </div>
            <div class="rodape"><button id="salvar1" class="btn btn-primary">Salvar</button></div>
          </div>
        </section>
      </div>
    </body></html>`;

    const contagem = { cliques: 0 };
    const { window, enviar } = montarPagina(html, {
      preparar: (w) => {
        w.document.querySelectorAll(".seta").forEach((b) => b.addEventListener("click", () => {
          b.closest(".item").querySelector(".detalhes").style.display = "block";
        }));
        w.document.getElementById("salvar1").addEventListener("click", () => {
          contagem.cliques += 1;
          if (contagem.cliques === 1) return; // 1º clique: o site ainda não estava pronto
          const aviso = w.document.createElement("div");
          aviso.setAttribute("role", "alert");
          aviso.className = "alert alert-success";
          aviso.textContent = "Proposta cadastrada com sucesso";
          w.document.querySelector(".item").appendChild(aviso);
        });
      },
    });

    const r = await enviar(preencher([1]));
    checar(contagem.cliques === 2, `clicou 2× (${contagem.cliques})`);
    checar(r.salvamentos[0]?.confirmado === true, `confirmado na 2ª tentativa (${r.salvamentos[0]?.mensagemSucesso})`);
    checar(r.salvamentos[0]?.tentativas === 2, "relatório: 2 tentativas");
    checar(JSON.stringify(r.savedItems) === JSON.stringify([1]), "savedItems = [1]");
    checar((window.document.querySelectorAll('[role="alert"]').length) === 1, "um único aviso (não duplicou)");
  }

  console.log("\n── 10) Máscara de moeda: só aceita digitação tecla a tecla ──");
  {
    const html = `<!DOCTYPE html><html><body>
      <h2>Itens</h2>
      <div id="lista">
        <section class="item" data-item="1">
          <div class="cabecalho"><div class="numero">1</div><div class="titulo">ITEM 1</div>
            <div class="publicados"><div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">10</span></div></div>
            <button class="seta" title="Mostrar detalhes do item"><svg></svg></button></div>
          <div class="detalhes">
            <div class="campos">
              <label>Valor unitário (R$)</label><input id="vu1" class="entrada" data-moeda="1" />
              <label>Marca/Fabricante</label><input id="mf1" class="entrada" />
              <label>Modelo/Versão</label><input id="mv1" class="entrada" />
            </div>
            <div class="rodape"><button id="salvar1" class="btn btn-primary">Salvar</button></div>
          </div>
        </section>
      </div>
    </body></html>`;

    const eventos = { salvos: [] };
    const { window, enviar } = montarPagina(html, {
      preparar: (w, c) => {
        w.document.querySelectorAll(".seta").forEach((b) => b.addEventListener("click", () => {
          b.closest(".item").querySelector(".detalhes").style.display = "block";
        }));

        // Máscara de moeda: aceita só tecla a tecla (data com um caractere);
        // valor posto de uma vez é descartado, como nos portais com máscara.
        const monetario = (digitos) => {
          const n = Number(digitos || "0") / 100; // máscara de moeda: digita centavos
          return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        };
        w.document.querySelectorAll('input[data-moeda="1"]').forEach((input) => {
          input.addEventListener("input", (e) => {
            if (!e.data || e.data.length !== 1) {
              input.value = "";
              return;
            }
            const digitos = input.value.replace(/\D/g, "");
            input.value = monetario(digitos);
          });
        });

        w.document.getElementById("salvar1").addEventListener("click", () => {
          const valor = w.document.getElementById("vu1").value;
          if (!/\d/.test(valor)) return; // inválido: o site não salva
          eventos.salvos.push(`salvar1:${valor}`);
          const aviso = w.document.createElement("div");
          aviso.setAttribute("role", "alert");
          aviso.className = "alert alert-success";
          aviso.textContent = "Item salvo com sucesso";
          w.document.querySelector(".item").appendChild(aviso);
        });
      },
    });

    const r = await enviar(preencher([1]));
    const valor = window.document.getElementById("vu1").value;
    checar(valor === "1.234,56", `a máscara formatou o valor digitado ("${valor}")`);
    checar(eventos.salvos.length >= 1, `o site salvou com o valor digitado (${JSON.stringify(eventos.salvos)})`);
    checar(r.salvamentos[0]?.confirmado === true, "relatório: salvo e confirmado");
    checar(JSON.stringify(r.savedItems) === JSON.stringify([1]), "savedItems = [1]");
  }

  console.log("\n── 11) Janela de confirmação depois do Salvar ──");
  {
    const html = `<!DOCTYPE html><html><body>
      <h2>Itens</h2>
      <div id="lista">
        <section class="item" data-item="1">
          <div class="cabecalho"><div class="numero">1</div><div class="titulo">ITEM 1</div>
            <div class="publicados"><div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">10</span></div></div>
            <button class="seta" title="Mostrar detalhes do item"><svg></svg></button></div>
          <div class="detalhes">
            <div class="campos">
              <label>Valor unitário (R$)</label><input id="vu1" class="entrada" />
              <label>Marca/Fabricante</label><input id="mf1" class="entrada" />
              <label>Modelo/Versão</label><input id="mv1" class="entrada" />
            </div>
            <div class="rodape"><button id="salvar1" class="btn btn-primary">Salvar</button></div>
          </div>
        </section>
      </div>
      <div id="modal" role="dialog" aria-modal="true" style="display:none">
        <p>Confirma o cadastro da proposta do item 1?</p>
        <button id="btn-cancelar-modal">Cancelar</button>
        <button id="btn-confirmar-modal">Confirmar</button>
      </div>
    </body></html>`;

    const eventos = { salvos: [], cancelamentos: 0 };
    const { window, enviar } = montarPagina(html, {
      preparar: (w, c) => {
        w.document.querySelectorAll(".seta").forEach((b) => b.addEventListener("click", () => {
          b.closest(".item").querySelector(".detalhes").style.display = "block";
        }));
        w.document.getElementById("salvar1").addEventListener("click", () => {
          w.document.getElementById("modal").style.display = "block";
        });
        w.document.getElementById("btn-cancelar-modal").addEventListener("click", () => {
          eventos.cancelamentos += 1;
          w.document.getElementById("modal").style.display = "none";
        });
        w.document.getElementById("btn-confirmar-modal").addEventListener("click", () => {
          eventos.salvos.push("item1");
          c.salvos.push("item1");
          w.document.getElementById("modal").style.display = "none";
          const aviso = w.document.createElement("div");
          aviso.setAttribute("role", "alert");
          aviso.className = "alert alert-success";
          aviso.textContent = "Proposta cadastrada com sucesso";
          w.document.querySelector(".item").appendChild(aviso);
        });
      },
    });

    const r = await enviar(preencher([1]));
    checar(eventos.cancelamentos === 0, "não clicou em Cancelar");
    checar(eventos.salvos.length === 1, `confirmou na janela (${JSON.stringify(eventos.salvos)})`);
    checar(r.salvamentos[0]?.confirmado === true, `relatório: confirmado (${r.salvamentos[0]?.mensagemSucesso || r.salvamentos[0]?.modal?.botao})`);
    checar(JSON.stringify(r.savedItems) === JSON.stringify([1]), "savedItems = [1]");
    // O valor é escrito no formato do portal (4 casas): 1234,5600 (sem máscara
    // não aparece o separador de milhar; com a máscara do site vira 1.234,5600).
    checar(r.salvamentos[0]?.valores?.valorUnitario === "1234,5600", `relatório traz os valores da página (${JSON.stringify(r.salvamentos[0]?.valores)})`);
    checar(r.salvamentos[0]?.valores?.modeloVersao === "PRIMACY 4", `modelo continua sendo texto (${JSON.stringify(r.salvamentos[0]?.valores)})`);
  }

  console.log("\n── 12) Máscara de 4 casas do portal: 44,0000 ──");
  {
    const { window, eventos, enviar1 } = ambienteComMascara(4, "44,0000");
    const r = await enviar1();
    checar(window.document.getElementById("vu1").value === "44,0000", `o campo ficou "44,0000" (${window.document.getElementById("vu1").value})`);
    checar(eventos.salvos[0]?.endsWith("44,0000"), `o site salvou com 44,0000 (${JSON.stringify(eventos.salvos)})`);
    checar(r.salvamentos[0]?.valores?.valorUnitario === "44,0000", `relatório traz 44,0000 (${JSON.stringify(r.salvamentos[0]?.valores)})`);
    checar(r.salvamentos[0]?.confirmado === true, "relatório: salvo e confirmado");
    checar(JSON.stringify(r.savedItems) === JSON.stringify([1]), "savedItems = [1]");
  }

  console.log("\n── 13) Máscara de 2 casas: ajusta o formato sozinho ──");
  {
    const { window, eventos, enviar1 } = ambienteComMascara(2, "44,0000");
    const r = await enviar1();
    checar(window.document.getElementById("vu1").value === "44,00", `o campo ficou "44,00" (${window.document.getElementById("vu1").value})`);
    checar(eventos.salvos[0]?.endsWith("44,00"), `o site salvou com 44,00 (${JSON.stringify(eventos.salvos)})`);
    checar(r.salvamentos[0]?.confirmado === true, "relatório: salvo e confirmado");
    checar(JSON.stringify(r.savedItems) === JSON.stringify([1]), "savedItems = [1]");
  }

  console.log("\n── 14) Formulário Angular: reforço faz o site registrar o valor ──");
  {
    const html = `<!DOCTYPE html><html><body>
      <h2>Itens</h2>
      <div id="lista">
        <section class="item" data-item="1">
          <div class="cabecalho"><div class="numero">1</div><div class="titulo">ITEM 1</div>
            <div class="publicados"><div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">10</span></div></div>
            <button class="seta" title="Mostrar detalhes do item"><svg></svg></button></div>
          <div class="detalhes">
            <div class="campos">
              <label>Valor unitário (R$)</label>
              <input id="vu1" class="entrada ng-pristine ng-untouched ng-invalid" />
              <label>Marca/Fabricante</label><input id="mf1" class="entrada" />
              <label>Modelo/Versão</label><input id="mv1" class="entrada" />
            </div>
            <div class="rodape"><button id="salvar1" class="btn btn-primary">Salvar</button></div>
          </div>
        </section>
      </div>
    </body></html>`;

    const eventos = { salvos: [], registros: 0 };
    const { window, enviar } = montarPagina(html, {
      preparar: (w) => {
        w.document.querySelectorAll(".seta").forEach((b) => b.addEventListener("click", () => {
          b.closest(".item").querySelector(".detalhes").style.display = "block";
        }));

        const campo = w.document.getElementById("vu1");
        const valido = () => /^\d{1,3}(\.\d{3})*,\d{4}$/.test(campo.value);

        // "Angular": registra o valor lido no momento do evento. Se a máscara
        // ainda não formatou (primeiro input), o valor chega cru e o campo
        // continua inválido — é exatamente o que trava o site de verdade.
        campo.addEventListener("input", () => {
          eventos.registros += 1;
          if (valido()) campo.className = "entrada ng-dirty ng-touched ng-valid";
        });

        // Máscara: formata depois (registrada por último, roda por último).
        campo.addEventListener("input", () => {
          const digitos = campo.value.replace(/\D/g, "");
          if (!digitos) return;
          const numero = Number(digitos) / 10000;
          campo.value = numero.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
        });

        w.document.getElementById("salvar1").addEventListener("click", () => {
          if (!campo.className.includes("ng-valid")) {
            const erro = w.document.createElement("div");
            erro.setAttribute("role", "alert");
            erro.className = "alert alert-danger";
            erro.textContent = 'O campo "Valor unitário" é obrigatório.';
            w.document.querySelector(".item").appendChild(erro);
            return;
          }
          eventos.salvos.push("salvar1");
          const ok = w.document.createElement("div");
          ok.setAttribute("role", "alert");
          ok.className = "alert alert-success";
          ok.textContent = "Proposta cadastrada com sucesso";
          w.document.querySelector(".item").appendChild(ok);
        });
      },
    });

    const r = await enviar(preencher([1]));
    checar(window.document.getElementById("vu1").className.includes("ng-valid"), "o formulário do site registrou o valor (ng-valid)");
    checar(eventos.salvos.length === 1, `o site salvou (${JSON.stringify(eventos.salvos)})`);
    checar(r.salvamentos[0]?.confirmado === true && !r.salvamentos[0]?.recusado, "relatório: salvo e confirmado");
    checar(JSON.stringify(r.savedItems) === JSON.stringify([1]), "savedItems = [1]");
    checar(!r.camposProblematicos?.length, "nenhum campo problemático");
  }

  console.log("\n── 15) Site recusa: campo obrigatório (não pode contar como salvo) ──");
  {
    const html = `<!DOCTYPE html><html><body>
      <h2>Itens</h2>
      <div id="lista">
        <section class="item" data-item="1">
          <div class="cabecalho"><div class="numero">1</div><div class="titulo">ITEM 1</div>
            <div class="publicados"><div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">10</span></div></div>
            <button class="seta" title="Mostrar detalhes do item"><svg></svg></button></div>
          <div class="detalhes">
            <div class="campos">
              <label>Valor unitário (R$)</label><input id="vu1" class="entrada" />
              <label>Marca/Fabricante</label><input id="mf1" class="entrada" />
              <label>Modelo/Versão</label><input id="mv1" class="entrada" />
            </div>
            <div class="rodape"><button id="salvar1" class="btn btn-primary">Salvar</button></div>
          </div>
        </section>
      </div>
    </body></html>`;

    const eventos = { cliques: 0 };
    const { window, enviar } = montarPagina(html, {
      preparar: (w) => {
        w.document.querySelectorAll(".seta").forEach((b) => b.addEventListener("click", () => {
          b.closest(".item").querySelector(".detalhes").style.display = "block";
        }));
        w.document.getElementById("salvar1").addEventListener("click", () => {
          eventos.cliques += 1;
          const erro = w.document.createElement("div");
          erro.setAttribute("role", "alert");
          erro.className = "alert alert-danger";
          erro.textContent = 'O campo "Valor unitário" é obrigatório.';
          w.document.querySelector(".item").appendChild(erro);
        });
      },
    });

    const r = await enviar(preencher([1]));
    const s0 = r.salvamentos[0];
    checar(eventos.cliques === 1, `clicou uma vez só (o site já respondeu) — ${eventos.cliques}`);
    checar(s0?.recusado === true, `relatório: recusado ("${s0?.motivo}")`);
    checar(s0?.confirmado === false, "não confirmado");
    checar(JSON.stringify(r.savedItems) === JSON.stringify([]), "NÃO entra em savedItems");
    checar(r.warnings.some((w) => /RECUSOU/.test(w)), "avisa que o site recusou");
  }

  console.log("\n── 16) Portal só contabiliza com tecla real (Backspace resolve) ──");
  {
    const html = `<!DOCTYPE html><html><body>
      <h2>Itens</h2>
      <div id="lista">
        <section class="item" data-item="1">
          <div class="cabecalho"><div class="numero">1</div><div class="titulo">ITEM 1</div>
            <div class="publicados"><div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">4</span></div></div>
            <button class="seta" title="Mostrar detalhes do item"><svg></svg></button></div>
          <div class="detalhes">
            <div class="campos">
              <label>Valor unitário (R$)</label><input id="vu1" class="entrada" />
              <label>Marca/Fabricante</label><input id="mf1" class="entrada" />
              <label>Modelo/Versão</label><input id="mv1" class="entrada" />
              <div class="campo"><span class="rotulo">Valor total</span><span class="valor" id="total1">R$ 0,0000</span></div>
            </div>
            <div class="rodape"><button id="salvar1" class="btn btn-primary">Salvar</button></div>
          </div>
        </section>
      </div>
    </body></html>`;

    const eventos = { salvos: [], teclas: [] };
    const { window, enviar } = montarPagina(html, {
      preparar: (w) => {
        w.document.querySelectorAll(".seta").forEach((b) => b.addEventListener("click", () => {
          b.closest(".item").querySelector(".detalhes").style.display = "block";
        }));

        const campo = w.document.getElementById("vu1");
        // Portal "Angular": o modelo só é atualizado quando chega uma TECLA de
        // verdade (keydown). Eventos de input sozinhos não contam — por isso o
        // valor aparecia na tela mas o total continuava R$ 0,0000.
        campo.addEventListener("keydown", (e) => {
          eventos.teclas.push(e.key);
          if (e.key === "Backspace") {
            const numero = Number(String(campo.value).replace(/\./g, "").replace(",", ".")) || 0;
            w.document.getElementById("total1").textContent =
              "R$ " + (numero * 4).toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
            campo.className = "entrada ng-dirty ng-touched ng-valid";
          }
        });

        // Máscara: formata o que estiver no campo.
        campo.addEventListener("input", () => {
          const digitos = campo.value.replace(/\D/g, "");
          if (!digitos) return;
          campo.value = (Number(digitos) / 10000).toLocaleString("pt-BR", {
            minimumFractionDigits: 4,
            maximumFractionDigits: 4,
          });
        });

        w.document.getElementById("salvar1").addEventListener("click", () => {
          if (w.document.getElementById("total1").textContent === "R$ 0,0000") {
            const erro = w.document.createElement("div");
            erro.setAttribute("role", "alert");
            erro.className = "alert alert-danger";
            erro.textContent = 'O campo "Valor unitário" é obrigatório.';
            w.document.querySelector(".item").appendChild(erro);
            return;
          }
          eventos.salvos.push(campo.value);
          const ok = w.document.createElement("div");
          ok.setAttribute("role", "alert");
          ok.className = "alert alert-success";
          ok.textContent = "Item salvo com sucesso";
          w.document.querySelector(".item").appendChild(ok);
        });
      },
    });

    const r = await enviar(preencher([1]));
    const total = window.document.getElementById("total1").textContent;
    checar(eventos.teclas.includes("Backspace"), `o bot apertou Backspace (${JSON.stringify(eventos.teclas.slice(-3))})`);
    checar(/4\.939,?\d*/i.test(total.replace("R$ ", "")) || total !== "R$ 0,0000", `o total saiu de 0,0000 (${total})`);
    checar(eventos.salvos.length === 1, `o site salvou (${JSON.stringify(eventos.salvos)})`);
    checar(r.salvamentos[0]?.confirmado === true && !r.salvamentos[0]?.recusado, "relatório: salvo e confirmado");
    checar(JSON.stringify(r.savedItems) === JSON.stringify([1]), "savedItems = [1]");
  }

  console.log("\n── 17) Máscara que insere na própria tecla: não duplica dígitos ──");
  {
    const html = `<!DOCTYPE html><html><body>
      <h2>Itens</h2>
      <div id="lista">
        <section class="item" data-item="1">
          <div class="cabecalho"><div class="numero">1</div><div class="titulo">ITEM 1</div>
            <div class="publicados"><div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">4</span></div></div>
            <button class="seta" title="Mostrar detalhes do item"><svg></svg></button></div>
          <div class="detalhes">
            <div class="campos">
              <label>Valor unitário (R$)</label><input id="vu1" class="entrada" />
              <label>Marca/Fabricante</label><input id="mf1" class="entrada" />
              <label>Modelo/Versão</label><input id="mv1" class="entrada" />
            </div>
            <div class="rodape"><button id="salvar1" class="btn btn-primary">Salvar</button></div>
          </div>
        </section>
      </div>
    </body></html>`;

    const eventos = { salvos: [] };
    const { window, enviar } = montarPagina(html, {
      preparar: (w) => {
        w.document.querySelectorAll(".seta").forEach((b) => b.addEventListener("click", () => {
          b.closest(".item").querySelector(".detalhes").style.display = "block";
        }));

        const campo = w.document.getElementById("vu1");
        // Máscara do portal: ela MESMA insere o dígito ao ver a tecla (keydown)
        // e reformata como moeda de 4 casas.
        campo.addEventListener("keydown", (e) => {
          if (!/^[0-9]$/.test(e.key || "")) return;
          const digitos = (campo.value.replace(/\D/g, "") + e.key).slice(-9);
          campo.value = (Number(digitos) / 10000).toLocaleString("pt-BR", {
            minimumFractionDigits: 4,
            maximumFractionDigits: 4,
          });
        });

        w.document.getElementById("salvar1").addEventListener("click", () => {
          eventos.salvos.push(campo.value);
          const aviso = w.document.createElement("div");
          aviso.setAttribute("role", "alert");
          aviso.className = "alert alert-success";
          aviso.textContent = "Item salvo com sucesso";
          w.document.querySelector(".item").appendChild(aviso);
        });
      },
    });

    const r = await enviar({
      action: "fill_items",
      delay: 20,
      items: [{ item: 1, valorUnitario: "1.232,8000", marcaFabricante: "Conforme TR", modeloVersao: "Conforme TR" }],
    });

    const valor = window.document.getElementById("vu1").value;
    checar(valor === "1.232,8000", `o valor ficou "1.232,8000" (${valor})`);
    checar(!/11|22|33|232232|8888/.test(valor), "nenhum dígito duplicado");
    checar(eventos.salvos[0] === "1.232,8000", `o site salvou o valor certo (${JSON.stringify(eventos.salvos)})`);
    checar(r.salvamentos[0]?.confirmado === true && !r.salvamentos[0]?.recusado, "relatório: salvo e confirmado");
    checar(JSON.stringify(r.savedItems) === JSON.stringify([1]), "savedItems = [1]");
  }

  console.log("\n── 18) Valor unitário lançado UMA vez só ──");
  {
    // Portal de verdade: a máscara de 4 casas insere o dígito na própria tecla
    // (keydown) e reformata. Contamos quantas vezes o campo é REESCRITO do zero
    // (o usuário via o valor sendo lançado e relançado).
    const montar = (casas) => {
      const html = `<!DOCTYPE html><html><body>
        <h2>Itens</h2>
        <div id="lista">
          <section class="item" data-item="1">
            <div class="cabecalho"><div class="numero">1</div><div class="titulo">ITEM 1</div>
              <div class="publicados"><div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">4</span></div>
              <div class="campo"><span class="rotulo">Valor estimado</span><span class="valor">R$ 100,00</span></div></div>
              <button class="seta" title="Mostrar detalhes do item"><svg></svg></button></div>
            <div class="detalhes" style="display:none">
              <div class="campos">
                <label>Valor unitário (R$)</label><input id="vu1" class="entrada" />
                <label>Marca/Fabricante</label><input id="mf1" class="entrada" />
                <label>Modelo/Versão</label><input id="mv1" class="entrada" />
              </div>
              <div class="rodape"><button id="salvar1" class="btn btn-primary">Salvar</button></div>
            </div>
          </section>
        </div>
      </body></html>`;

      const eventos = { salvos: [], limpezas: 0 };
      const { window, enviar } = montarPagina(html, {
        preparar: (w) => {
          // Conta cada vez que o campo de valor é limpo (= novo lançamento).
          // Fica no prototype porque o content.js escreve pelo setter nativo.
          const proto = w.HTMLInputElement.prototype;
          const descritor = w.Object.getOwnPropertyDescriptor(proto, "value");
          w.Object.defineProperty(proto, "value", {
            configurable: true,
            get() {
              return descritor.get.call(this);
            },
            set(novo) {
              const antes = descritor.get.call(this);
              descritor.set.call(this, novo);
              if (this.id === "vu1" && String(antes) !== "" && String(novo) === "") eventos.limpezas += 1;
            },
          });

          w.document.querySelectorAll(".seta").forEach((b) => b.addEventListener("click", () => {
            b.closest(".item").querySelector(".detalhes").style.display = "block";
          }));

          const campo = w.document.getElementById("vu1");
          campo.addEventListener("keydown", (e) => {
            if (!/^[0-9]$/.test(e.key || "")) return;
            const digitos = (campo.value.replace(/\D/g, "") + e.key).slice(-12);
            campo.value = (Number(digitos) / 10 ** casas).toLocaleString("pt-BR", {
              minimumFractionDigits: casas,
              maximumFractionDigits: casas,
            });
          });

          w.document.getElementById("salvar1").addEventListener("click", () => {
            eventos.salvos.push(campo.value);
            const aviso = w.document.createElement("div");
            aviso.setAttribute("role", "alert");
            aviso.className = "alert alert-success";
            aviso.textContent = "Item salvo com sucesso";
            w.document.querySelector(".item").appendChild(aviso);
          });
        },
      });
      return { window, eventos, enviar };
    };

    // a) valor já no formato do portal (4 casas): 1 lançamento
    {
      const { window, eventos, enviar } = montar(4);
      const r = await enviar({
        action: "fill_items",
        delay: 20,
        items: [{ item: 1, valorUnitario: "1.232,8000", marcaFabricante: "MICHELIN", modeloVersao: "PRIMACY 4" }],
      });
      const valor = window.document.getElementById("vu1").value;
      checar(valor === "1.232,8000", `o campo ficou "1.232,8000" (${valor})`);
      // O campo estava vazio: o valor entrou uma única vez, sem nenhum
      // "limpa e digita de novo" (que era o relança-relança relatado).
      checar(eventos.limpezas === 0, `nenhum relançamento do valor (limpezas: ${eventos.limpezas})`);
      checar(
        r.salvamentos[0]?.lancamentos?.valorUnitario === 1,
        `relatório: 1 lançamento do valor (${JSON.stringify(r.salvamentos[0]?.lancamentos)})`,
      );
      checar(eventos.salvos[0] === "1.232,8000", `o site salvou o valor certo (${JSON.stringify(eventos.salvos)})`);
    }

    // b) valor com menos casas na planilha ("162,99"): o bot já digita no
    //    formato do portal e NÃO precisa lançar de novo
    {
      const { window, eventos, enviar } = montar(4);
      const r = await enviar({
        action: "fill_items",
        delay: 20,
        items: [{ item: 1, valorUnitario: "162,99", marcaFabricante: "Conforme TR", modeloVersao: "Conforme TR" }],
      });
      const valor = window.document.getElementById("vu1").value;
      checar(valor === "162,9900", `o valor virou "162,9900" (${valor})`);
      checar(eventos.limpezas === 0, `lançado 1 vez, sem relançar (limpezas: ${eventos.limpezas})`);
      checar(eventos.salvos[0] === "162,9900", `o site salvou 162,9900 (${JSON.stringify(eventos.salvos)})`);
      checar(r.filled === 1, `item preenchido (${r.filled})`);
    }

    // c) máscara de 2 casas: o bot identifica a escala na primeira tecla e
    //    termina em uma única passada, sem limpar e relançar o valor.
    {
      const { window, eventos, enviar } = montar(2);
      const r = await enviar({
        action: "fill_items",
        delay: 20,
        items: [{ item: 1, valorUnitario: "1.232,8000", marcaFabricante: "MICHELIN", modeloVersao: "PRIMACY 4" }],
      });
      const valor = window.document.getElementById("vu1").value;
      checar(valor === "1.232,80", `o valor virou "1.232,80" (${valor})`);
      checar(eventos.limpezas === 0, `sem relançamento para corrigir a escala (limpezas: ${eventos.limpezas})`);
      checar(
        r.salvamentos[0]?.lancamentos?.valorUnitario === 1,
        `relatório: valor lançado uma vez (${JSON.stringify(r.salvamentos[0]?.lancamentos)})`,
      );
      checar(eventos.salvos[0] === "1.232,80", `o site salvou 1.232,80 (${JSON.stringify(eventos.salvos)})`);
      checar(r.salvamentos[0]?.confirmado === true, "relatório: salvo e confirmado");
    }

    // e) modelo só com número continua TEXTO ("208", não "208,0000")
    {
      const { window, enviar } = montar(4);
      const r = await enviar({
        action: "fill_items",
        delay: 20,
        items: [{ item: 1, valorUnitario: "1.232,8000", marcaFabricante: "FIAT", modeloVersao: "208" }],
      });
      const modelo = window.document.getElementById("mv1").value;
      checar(modelo === "208", `modelo ficou texto ("208", não "208,0000") — ${modelo}`);
      checar(r.filled === 1, `item preenchido (${r.filled})`);
    }

    // d) rodar de novo no mesmo item NÃO relança o valor (já está certo)
    {
      const { window, eventos, enviar } = montar(4);
      const preencher1 = {
        action: "fill_items",
        delay: 20,
        items: [{ item: 1, valorUnitario: "1.232,8000", marcaFabricante: "MICHELIN", modeloVersao: "PRIMACY 4" }],
      };
      await enviar(preencher1);
      const limpezasDepoisDaPrimeira = eventos.limpezas;
      const r = await enviar(preencher1);
      checar(
        eventos.limpezas === limpezasDepoisDaPrimeira,
        `a 2ª rodada não relançou o valor (limpezas: ${eventos.limpezas})`,
      );
      checar(window.document.getElementById("vu1").value === "1.232,8000", `o campo continua "1.232,8000"`);
      checar(r.filled === 1, `2ª rodada também preenche (${r.filled})`);
    }
  }

  console.log("\n── 19) Preenche na ordem do Item e não pula item de painel devagar ──");
  {
    // Lista com 3 itens; o painel do item 2 só monta 600ms depois da seta —
    // é o que fazia o bot "pular" um item. A planilha ainda chega fora de ordem.
    const item = (n) => `
      <section class="item" data-item="${n}">
        <div class="cabecalho"><div class="numero">${n}</div><div class="titulo">ITEM ${n}</div>
          <div class="publicados">
            <div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">10</span></div>
            <div class="campo"><span class="rotulo">Valor estimado</span><span class="valor">R$ 100,00</span></div>
          </div>
          <button class="seta" title="Mostrar detalhes do item"><svg></svg></button>
        </div>
        <div class="detalhes" style="display:none">
          <div class="campos">
            <label>Valor unitário (R$)</label><input id="vu${n}" class="entrada" />
            <label>Marca/Fabricante</label><input id="mf${n}" class="entrada" />
            <label>Modelo/Versão</label><input id="mv${n}" class="entrada" />
          </div>
          <div class="rodape"><button id="salvar${n}" class="btn btn-primary">Salvar</button></div>
        </div>
      </section>`;

    const html = `<!DOCTYPE html><html><body>
      <h2>Itens</h2>
      <div id="lista">${[1, 2, 3].map(item).join("\n")}</div>
    </body></html>`;

    const eventos = { salvos: [] };
    const { window, enviar } = montarPagina(html, {
      preparar: (w, c) => {
        w.document.querySelectorAll(".seta").forEach((b) => {
          b.addEventListener("click", () => {
            const bloco = b.closest(".item");
            const painel = bloco.querySelector(".detalhes");
            if (bloco.dataset.item === "2") {
              setTimeout(() => {
                painel.style.display = "block";
              }, 600);
              return;
            }
            painel.style.display = "block";
          });
        });

        w.document.querySelectorAll("button[id^='salvar']").forEach((botao) => {
          botao.addEventListener("click", () => {
            eventos.salvos.push(botao.id.replace("salvar", ""));
            c.salvos.push(botao.id);
            const aviso = w.document.createElement("div");
            aviso.setAttribute("role", "alert");
            aviso.className = "alert alert-success";
            aviso.textContent = "Item salvo com sucesso";
            botao.closest(".item").appendChild(aviso);
          });
        });
      },
    });

    // Chega fora de ordem de propósito: 3, 1, 2.
    const r = await enviar({
      action: "fill_items",
      delay: 20,
      items: [
        { item: 3, valorUnitario: "33,0000", marcaFabricante: "ACME 3", modeloVersao: "X3" },
        { item: 1, valorUnitario: "11,0000", marcaFabricante: "ACME 1", modeloVersao: "X1" },
        { item: 2, valorUnitario: "22,0000", marcaFabricante: "ACME 2", modeloVersao: "X2" },
      ],
    });

    const valor = (n) => window.document.getElementById(`vu${n}`).value;
    checar(r.filled === 3, `preencheu os 3 itens, sem pular nenhum (${r.filled} de ${r.total})`);
    checar(r.errors.length === 0, `nenhum erro de item (${JSON.stringify(r.errors)})`);
    checar(
      JSON.stringify(eventos.salvos) === JSON.stringify(["1", "2", "3"]),
      `salvou na ordem do item: 1, 2, 3 (${JSON.stringify(eventos.salvos)})`,
    );
    checar(JSON.stringify(r.savedItems) === JSON.stringify([1, 2, 3]), `savedItems = ${JSON.stringify(r.savedItems)}`);
    checar(valor(1) === "11,0000", `item 1 ficou com o valor do item 1 (${valor(1)})`);
    checar(valor(2) === "22,0000", `item 2 ficou com o valor do item 2 (${valor(2)})`);
    checar(valor(3) === "33,0000", `item 3 ficou com o valor do item 3 (${valor(3)})`);
  }

  console.log("\n── 20) Velocidade turbo (0,03s e 0,001s) preenche igual e mais rápido ──");
  {
    // Página no formato do PORTAL (máscara que reage na própria tecla): é nela
    // que a velocidade é medida, porque em campo sem máscara o bot espera um
    // instante por dígito para não escrever antes da máscara (proteção contra
    // o dígito duplicado do cenário 21).
    const montarPortal = (casas) => {
      const item = (n) => `
        <section class="item" data-item="${n}">
          <div class="cabecalho"><div class="numero">${n}</div><div class="titulo">ITEM ${n}</div>
            <div class="publicados"><div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">10</span></div>
            <div class="campo"><span class="rotulo">Valor estimado (unitário)</span><span class="valor">R$ 100,00</span></div></div>
            <button class="seta" title="Mostrar detalhes do item"><svg></svg></button></div>
          <div class="detalhes" style="display:none">
            <div class="campos">
              <label>Valor unitário (R$)</label><input id="vu${n}" class="entrada" placeholder="0,0000" />
              <label>Marca/Fabricante</label><input id="mf${n}" class="entrada" />
              <label>Modelo/Versão</label><input id="mv${n}" class="entrada" />
            </div>
            <div class="rodape"><button id="salvar${n}" class="btn btn-primary">Salvar</button></div>
          </div>
        </section>`;
      const html = `<!DOCTYPE html><html><body><h2>Itens</h2><div id="lista">${[1, 2, 3].map(item).join("\n")}</div></body></html>`;

      const eventos = { salvos: [] };
      const { window, enviar } = montarPagina(html, {
        preparar: (w, c) => {
          w.document.querySelectorAll(".seta").forEach((b) => b.addEventListener("click", () => {
            b.closest(".item").querySelector(".detalhes").style.display = "block";
          }));
          const formatar = (digitos) =>
            (Number(digitos || "0") / 10 ** casas).toLocaleString("pt-BR", {
              minimumFractionDigits: casas,
              maximumFractionDigits: casas,
            });
          w.document.querySelectorAll("input[id^='vu']").forEach((campo) => {
            campo.addEventListener("keydown", (e) => {
              if (!/^[0-9]$/.test(e.key || "")) return;
              campo.value = formatar((campo.value.replace(/\D/g, "") + e.key).slice(-12));
            });
          });
          w.document.querySelectorAll("button[id^='salvar']").forEach((botao) => {
            botao.addEventListener("click", () => {
              eventos.salvos.push(botao.id);
              c.salvos.push(botao.id);
              const aviso = w.document.createElement("div");
              aviso.setAttribute("role", "alert");
              aviso.className = "alert alert-success";
              aviso.textContent = "Item salvo com sucesso";
              botao.closest(".item").appendChild(aviso);
            });
          });
        },
      });
      return { window, eventos, enviar };
    };

    const rodar = async (delay) => {
      const { eventos, enviar } = montarPortal(4);
      const inicio = Date.now();
      const r = await enviar({
        action: "fill_items",
        delay,
        items: [1, 2, 3].map((n) => ({
          item: n,
          valorUnitario: "1234,56",
          marcaFabricante: "MICHELIN",
          modeloVersao: "PRIMACY 4",
        })),
      });
      return { r, eventos, ms: Date.now() - inicio };
    };

    const normal = await rodar(1000);
    const turbo = await rodar(30);

    checar(normal.r.filled === 3 && turbo.r.filled === 3, `as duas velocidades preenchem 3/3 (normal ${normal.r.filled}, turbo ${turbo.r.filled})`);
    checar(
      JSON.stringify(turbo.r.savedItems) === JSON.stringify([1, 2, 3]),
      `turbo salva os 3 itens na ordem (${JSON.stringify(turbo.r.savedItems)})`,
    );
    checar(turbo.eventos.salvos.length === 3, `turbo clicou no Salvar dos 3 (${turbo.eventos.salvos.length})`);
    checar(
      turbo.r.salvamentos.every((s) => s.clicado && s.confirmado && !s.recusado),
      "turbo: todos salvos e confirmados pelo site",
    );
    checar(
      turbo.r.salvamentos.every((s) => s.lancamentos?.valorUnitario === 1),
      `turbo: valor lançado 1x por item (${JSON.stringify(turbo.r.salvamentos.map((s) => s.lancamentos?.valorUnitario))})`,
    );
    // A velocidade tem que valer para o item inteiro, não só para a pausa.
    checar(
      turbo.ms < normal.ms * 0.6,
      `turbo bem mais rápido que 1s (${turbo.ms}ms vs ${normal.ms}ms)`,
    );
    checar(turbo.ms < 4000, `turbo rápido de verdade (${turbo.ms}ms para 3 itens)`);

    // Velocidade máxima: 0,001s (1ms de pausa) — o piso de 1ms não pode quebrar
    // nada: os 3 itens continuam sendo preenchidos, salvos e conferidos.
    const maximo = await rodar(1);
    checar(maximo.r.filled === 3, `0,001s: preencheu 3/3 (${maximo.r.filled})`);
    checar(
      JSON.stringify(maximo.r.savedItems) === JSON.stringify([1, 2, 3]),
      `0,001s: salvou os 3 itens na ordem (${JSON.stringify(maximo.r.savedItems)})`,
    );
    checar(
      maximo.r.salvamentos.every((s) => s.clicado && s.confirmado && !s.recusado),
      "0,001s: todos salvos e confirmados pelo site",
    );
    checar(
      maximo.r.salvamentos.every((s) => s.lancamentos?.valorUnitario === 1),
      `0,001s: valor lançado 1x por item (${JSON.stringify(maximo.r.salvamentos.map((s) => s.lancamentos?.valorUnitario))})`,
    );
    checar(
      maximo.ms < turbo.ms,
      `0,001s mais rápido que 0,03s (${maximo.ms}ms vs ${turbo.ms}ms)`,
    );
    checar(maximo.ms < 3000, `0,001s rápido de verdade (${maximo.ms}ms para 3 itens)`);
  }

  console.log("\n── 21) Máscara assíncrona em velocidade máxima: um lançamento por dígito ──");
  {
    // Máscara do portal de verdade (Angular): ela reage à tecla de forma
    // ASSÍNCRONA (aplicando o dígito depois, com o que está no campo). Em
    // velocidade máxima o bot antigo inseria o dígito por conta própria antes de
    // a máscara reagir — o dígito entrava duas vezes e 1.232,8000 virava
    // 12.328,0000 (uma casa decimal a mais, como no print do usuário).
    const montar = (atrasoMs) => {
      const html = `<!DOCTYPE html><html><body>
        <h2>Itens</h2>
        <div id="lista">
          <section class="item" data-item="1">
            <div class="cabecalho"><div class="numero">1</div><div class="titulo">ITEM 1</div>
              <div class="publicados">
                <div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">4</span></div>
                <div class="campo"><span class="rotulo">Valor estimado (unitário)</span><span class="valor">R$ 1.232,8000</span></div>
              </div>
              <button class="seta" title="Mostrar detalhes do item"><svg></svg></button></div>
            <div class="detalhes" style="display:none">
              <div class="campos">
                <label>Valor unitário (R$)</label><input id="vu1" class="entrada" placeholder="0,0000" />
                <label>Marca/Fabricante</label><input id="mf1" class="entrada" />
                <label>Modelo/Versão</label><input id="mv1" class="entrada" />
                <div class="campo"><span class="rotulo">Valor total</span><span class="valor" id="total1">R$ 0,0000</span></div>
              </div>
              <div class="rodape"><button id="salvar1" class="btn btn-primary">Salvar</button></div>
            </div>
          </section>
        </div>
      </body></html>`;

      const eventos = { salvos: [], recusas: 0 };
      const { window, enviar } = montarPagina(html, {
        preparar: (w) => {
          w.document.querySelectorAll(".seta").forEach((b) => b.addEventListener("click", () => {
            b.closest(".item").querySelector(".detalhes").style.display = "block";
          }));

          const campo = w.document.getElementById("vu1");
          const formatar = (digitos) =>
            (Number(digitos || "0") / 10000).toLocaleString("pt-BR", {
              minimumFractionDigits: 4,
              maximumFractionDigits: 4,
            });

          // Máscara assíncrona: a tecla é aplicada depois, em cima do que
          // estiver no campo naquele momento (é o que duplicava o dígito quando
          // o bot digitava por conta própria antes da máscara reagir).
          campo.addEventListener("keydown", (e) => {
            if (e.key === "Backspace") {
              setTimeout(() => {
                const digitos = campo.value.replace(/\D/g, "").slice(0, -1);
                campo.value = formatar(digitos);
              }, atrasoMs);
              return;
            }
            if (!/^[0-9]$/.test(e.key || "")) return;
            setTimeout(() => {
              const digitos = campo.value.replace(/\D/g, "") + e.key;
              campo.value = formatar(digitos.slice(-12));
            }, atrasoMs);
          });

          w.document.getElementById("salvar1").addEventListener("click", () => {
            const valor = campo.value;
            if (!/\d/.test(valor) || valor.replace(/\D/g, "").length > 9) {
              eventos.recusas += 1;
              const erro = w.document.createElement("div");
              erro.setAttribute("role", "alert");
              erro.className = "alert alert-danger";
              erro.textContent = 'O campo "Valor unitário" é inválido.';
              w.document.querySelector(".item").appendChild(erro);
              return;
            }
            eventos.salvos.push(valor);
            const aviso = w.document.createElement("div");
            aviso.setAttribute("role", "alert");
            aviso.className = "alert alert-success";
            aviso.textContent = "Item salvo com sucesso";
            w.document.querySelector(".item").appendChild(aviso);
          });
        },
      });
      return { window, eventos, enviar };
    };

    const payload = {
      action: "fill_items",
      items: [{ item: 1, valorUnitario: "1.232,8000", marcaFabricante: "Conforme TR", modeloVersao: "Conforme TR" }],
    };

    // a) velocidade máxima (0,001s)
    {
      const { window, eventos, enviar } = montar(0);
      const r = await enviar({ ...payload, delay: 1 });
      const valor = window.document.getElementById("vu1").value;
      checar(valor === "1.232,8000", `0,001s: o campo ficou "1.232,8000" (${valor})`);
      checar(
        window.document.getElementById("vu1").value.replace(/\D/g, "") === "12328000",
        `0,001s: dígitos corretos, sem dígito a mais (${window.document.getElementById("vu1").value.replace(/\D/g, "")})`,
      );
      checar(eventos.recusas === 0, `0,001s: o site não recusou nenhum salvamento (${eventos.recusas})`);
      checar(eventos.salvos[0] === "1.232,8000", `0,001s: o site salvou 1.232,8000 (${JSON.stringify(eventos.salvos)})`);
      checar(r.filled === 1 && !r.errors.length, `0,001s: item preenchido sem erro (${r.filled}; ${JSON.stringify(r.errors)})`);
      checar(
        r.salvamentos[0]?.lancamentos?.valorUnitario === 1,
        `0,001s: valor lançado 1x (${JSON.stringify(r.salvamentos[0]?.lancamentos)})`,
      );
    }

    // b) velocidade normal (1s) continua certa
    {
      const { window, eventos, enviar } = montar(0);
      const r = await enviar({ ...payload, delay: 1000 });
      const valor = window.document.getElementById("vu1").value;
      checar(valor === "1.232,8000", `1s: o campo ficou "1.232,8000" (${valor})`);
      checar(eventos.salvos[0] === "1.232,8000", `1s: o site salvou 1.232,8000 (${JSON.stringify(eventos.salvos)})`);
      checar(r.filled === 1, `1s: item preenchido (${r.filled})`);
    }
  }

  console.log("\n── 22) Valores inteiros preservam todos os dígitos e continuam nos outros campos ──");
  {
    const numeros = [1, 10, 100, 1000, 10000];
    const item = (n) => `
      <section class="item" data-item="${n}">
        <div class="cabecalho"><div class="numero">${n}</div><div class="titulo">ITEM ${n}</div>
          <div class="publicados"><div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">1</span></div></div>
          <button class="seta" title="Mostrar detalhes do item"><svg></svg></button>
        </div>
        <div class="detalhes" style="display:none">
          <label>Valor unitário (R$)</label><input id="vu${n}" placeholder="0,0000" />
          <label>Marca/Fabricante</label><input id="mf${n}" />
          <label>Modelo/Versão</label><input id="mv${n}" />
          <button id="salvar${n}">Salvar</button>
        </div>
      </section>`;
    const html = `<!DOCTYPE html><html><body><h2>Itens</h2><div id="lista">${numeros.map(item).join("")}</div></body></html>`;
    const eventos = { salvos: [] };
    const formatar = (digitos) => `${(Number(digitos || "0") / 10000).toFixed(4)}`.replace(".", ",");
    const { window, enviar } = montarPagina(html, {
      preparar: (w, cliques) => {
        w.document.querySelectorAll(".seta").forEach((botao) => botao.addEventListener("click", () => {
          botao.closest(".item").querySelector(".detalhes").style.display = "block";
        }));
        w.document.querySelectorAll('input[id^="vu"]').forEach((campo) => campo.addEventListener("keydown", (event) => {
          if (event.key === "Backspace") {
            campo.value = formatar(campo.value.replace(/\D/g, "").slice(0, -1));
            return;
          }
          if (/^\d$/.test(event.key || "")) {
            campo.value = formatar((campo.value.replace(/\D/g, "") + event.key).slice(-12));
          }
        }));
        w.document.querySelectorAll('button[id^="salvar"]').forEach((botao) => botao.addEventListener("click", () => {
          eventos.salvos.push(botao.closest(".item").querySelector('input[id^="vu"]').value);
          cliques.salvos.push(botao.id);
          const aviso = w.document.createElement("div");
          aviso.setAttribute("role", "alert");
          aviso.className = "alert alert-success";
          aviso.textContent = "Item salvo com sucesso";
          botao.closest(".item").appendChild(aviso);
        }));
      },
    });

    const itens = numeros.map((numero) => ({
      item: numero,
      valorUnitario: `${numero},0000`,
      marcaFabricante: `Marca ${numero}`,
      modeloVersao: `Modelo ${numero}`,
    }));
    const r = await enviar({ action: "fill_items", delay: 1, items: itens });

    checar(r.filled === numeros.length && r.errors.length === 0, `preencheu sem erros (${r.filled}/${numeros.length}; ${JSON.stringify(r.errors)})`);
    checar(JSON.stringify(r.savedItems) === JSON.stringify(numeros), `salvou os itens na ordem (${JSON.stringify(r.savedItems)})`);
    checar(JSON.stringify(eventos.salvos) === JSON.stringify(numeros.map((numero) => `${numero},0000`)), `salvou os valores exatos (${JSON.stringify(eventos.salvos)})`);
    for (const numero of numeros) {
      const valor = window.document.getElementById(`vu${numero}`).value;
      checar(valor === `${numero},0000`, `item ${numero}: valor unitário ${numero},0000 sem perder dígitos ("${valor}")`);
      checar(window.document.getElementById(`vu${numero}`).value.replace(/\D/g, "") === `${numero}0000`, `item ${numero}: escala de 4 casas preservada`);
      checar(window.document.getElementById(`mf${numero}`).value === `Marca ${numero}`, `item ${numero}: preencheu marca depois do valor`);
      checar(window.document.getElementById(`mv${numero}`).value === `Modelo ${numero}`, `item ${numero}: preencheu modelo depois do valor`);
    }
    checar(
      r.salvamentos.every((salvamento) => salvamento.lancamentos?.valorUnitario === 1),
      `cada valor foi lançado uma única vez (${JSON.stringify(r.salvamentos.map((salvamento) => salvamento.lancamentos?.valorUnitario))})`,
    );
  }

  console.log("\n── 23) Valor 67,4100 + confirmação sem ARIA/classe conhecida ──");
  {
    const html = `<!DOCTYPE html><html><body>
      <h2>Itens</h2>
      <section data-item="1">
        <div class="cabecalho"><div class="numero">1</div><div class="titulo">BRINQUEDO EM GERAL</div>
          <div class="publicados">
            <div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">15</span></div>
            <div class="campo"><span class="rotulo">Valor estimado (unitário)</span><span class="valor">R$ 67,4100</span></div>
          </div>
          <button class="seta" title="Mostrar detalhes do item"><svg></svg></button>
        </div>
        <div class="detalhes">
          <label>Valor unitário (R$)</label><input id="vu1" class="entrada" />
          <div class="campo"><span class="rotulo">Valor total</span><span class="valor" id="total1">R$ 0,0000</span></div>
          <label>Marca/Fabricante</label><input id="mf1" class="entrada" />
          <label>Modelo/Versão</label><input id="mv1" class="entrada" />
          <button id="salvar1">Salvar</button>
        </div>
      </section>
      <div id="janela-confirmacao" style="display:none">
        <div>Confirmação</div>
        <p>A proposta do item 1 foi modificada. Deseja salvar as alterações?</p>
        <div>
          <button id="btn-nao">Não</button>
          <button id="btn-sim">Sim</button>
        </div>
      </div>
    </body></html>`;

    const eventos = { salvamentos: [], sim: 0, nao: 0 };
    const formatarMoeda = (digitos) => (Number(digitos || "0") / 10000).toLocaleString("pt-BR", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    });
    const { window, enviar } = montarPagina(html, {
      preparar: (w) => {
        const campo = w.document.getElementById("vu1");
        const atualizarTotal = () => {
          const valor = Number(campo.value.replace(/\./g, "").replace(",", ".")) || 0;
          w.document.getElementById("total1").textContent = `R$ ${(valor * 15).toLocaleString("pt-BR", {
            minimumFractionDigits: 4,
            maximumFractionDigits: 4,
          })}`;
        };
        w.document.querySelector(".seta").addEventListener("click", () => {
          w.document.querySelector(".detalhes").style.display = "block";
        });
        // Máscara controlada por input: só o Backspace usado para registrar o
        // modelo atualiza o total; a tecla não deve apagar/redigitar o preço.
        campo.addEventListener("input", () => {
          campo.value = formatarMoeda(campo.value.replace(/\D/g, ""));
        });
        campo.addEventListener("keydown", (event) => {
          if (event.key === "Backspace") {
            atualizarTotal();
            campo.className = "entrada ng-dirty ng-touched ng-valid";
          }
        });
        w.document.getElementById("salvar1").addEventListener("click", () => {
          w.document.getElementById("janela-confirmacao").style.display = "block";
        });
        w.document.getElementById("btn-nao").addEventListener("click", () => {
          eventos.nao += 1;
          w.document.getElementById("janela-confirmacao").style.display = "none";
        });
        w.document.getElementById("btn-sim").addEventListener("click", () => {
          eventos.sim += 1;
          eventos.salvamentos.push(campo.value);
          w.document.getElementById("janela-confirmacao").style.display = "none";
          const toast = w.document.createElement("div");
          toast.setAttribute("role", "alert");
          toast.textContent = "Proposta cadastrada com sucesso";
          w.document.querySelector("section[data-item='1']").appendChild(toast);
        });
      },
    });

    const modal = window.document.getElementById("janela-confirmacao");
    const r = await enviar({
      action: "fill_items",
      delay: 20,
      items: [{ item: 1, valorUnitario: "67,4100", marcaFabricante: "ACME", modeloVersao: "Modelo 1" }],
    });
    const valor = window.document.getElementById("vu1").value;
    checar(valor === "67,4100", `campo preserva exatamente 67,4100 ("${valor}")`);
    checar(window.document.getElementById("total1").textContent === "R$ 1.011,1500", `o portal calculou o total correto (${window.document.getElementById("total1").textContent})`);
    checar(eventos.sim === 1 && eventos.nao === 0, `clicou em Sim e nunca em Não (Sim ${eventos.sim}, Não ${eventos.nao})`);
    checar(eventos.salvamentos[0] === "67,4100", `o site salvou o valor unitário correto (${JSON.stringify(eventos.salvamentos)})`);
    checar(r.salvamentos[0]?.modal?.botao === "sim", `o relatório reconheceu a confirmação sem ARIA/classe (${r.salvamentos[0]?.modal?.botao})`);
    checar(r.salvamentos[0]?.confirmado === true && JSON.stringify(r.savedItems) === "[1]", "item confirmado e salvo no relatório");
    checar(r.salvamentos[0]?.lancamentos?.valorUnitario === 1, "valor unitário lançado uma única vez");
    checar(window.document.getElementById("mf1").value === "ACME" && window.document.getElementById("mv1").value === "Modelo 1", "marca e modelo continuam sendo preenchidos depois do preço");
    checar(!modal.getAttribute("role") && !modal.getAttribute("aria-modal") && !modal.className, "caixa de confirmação não usa role, aria-modal nem classe conhecida");
  }

  console.log("\n── 24) Se a máscara trocar 67,4100 por 6,0000, não salva o preço errado ──");
  {
    const html = `<!DOCTYPE html><html><body>
      <section data-item="1">
        <div class="numero">1</div><div class="titulo">BRINQUEDO EM GERAL</div>
        <div><span class="rotulo">Quantidade solicitada</span><span class="valor">15</span></div>
        <div><span class="rotulo">Valor estimado (unitário)</span><span class="valor">R$ 67,4100</span></div>
        <button class="seta" title="Mostrar detalhes do item">Detalhes</button>
        <div class="detalhes">
          <label>Valor unitário (R$)</label><input id="vu1" />
          <label>Marca/Fabricante</label><input id="mf1" />
          <label>Modelo/Versão</label><input id="mv1" />
          <button id="salvar1">Salvar</button>
        </div>
      </section>
    </body></html>`;
    const eventos = { salvamentos: 0, corrompeu: false };
    let digitosDaMascara = "";
    const formatarMoeda = (digitos) => (Number(digitos || "0") / 10000).toLocaleString("pt-BR", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    });
    const { window, enviar } = montarPagina(html, {
      preparar: (w) => {
        const campo = w.document.getElementById("vu1");
        campo.addEventListener("input", (event) => {
          // Reproduz máscara baseada em InputEvent.data: setter com texto inteiro
          // e evento que carrega apenas o último caractere não sincronizam o modelo.
          if (event.inputType === "deleteContentBackward") digitosDaMascara = digitosDaMascara.slice(0, -1);
          else if (/^\d$/.test(event.data || "")) digitosDaMascara += event.data;
          campo.value = formatarMoeda(digitosDaMascara);
        });
        campo.addEventListener("keydown", (event) => {
          if (event.key === "Backspace" && !eventos.corrompeu) {
            eventos.corrompeu = true;
            digitosDaMascara = campo.value.replace(/\D/g, "");
            campo.value = "6,0000"; // reproduz a escala incorreta observada na captura
          }
        });
        w.document.querySelector(".seta").addEventListener("click", () => {
          w.document.querySelector(".detalhes").style.display = "block";
        });
        w.document.getElementById("salvar1").addEventListener("click", () => {
          eventos.salvamentos += 1;
        });
      },
    });

    const r = await enviar({
      action: "fill_items",
      delay: 20,
      items: [{ item: 1, valorUnitario: "67,4100", marcaFabricante: "ACME", modeloVersao: "Modelo 1" }],
    });
    checar(eventos.corrompeu, "o harness aplicou a alteração incorreta da máscara");
    checar(eventos.salvamentos === 0 && !r.savedItems.length, "não clicou Salvar nem marcou o item como enviado");
    checar(r.filled === 0, `item não conta como preenchido/salvo (${r.filled})`);
    checar(window.document.getElementById("mf1").value === "ACME" && window.document.getElementById("mv1").value === "Modelo 1", "mesmo sem salvar, continuou preenchendo marca e modelo");
    checar(r.errors.some((erro) => /valor unitário/i.test(erro)), `informa que o valor precisa ser corrigido (${JSON.stringify(r.errors)})`);
    checar(r.camposProblematicos.some((campo) => campo.esperado === "67,4100"), `o relatório diferencia o preço esperado 67,4100 (${JSON.stringify(r.camposProblematicos)})`);
  }

  console.log("\n── 25) Máscara mostra 6,0000; prefixo cru termina em 67,4100 e salva ──");
  {
    const html = `<!DOCTYPE html><html><body>
      <h2>Itens</h2>
      <section class="item" data-item="1">
        <div class="cabecalho"><div class="numero">1</div><div class="titulo">BRINQUEDO EM GERAL</div>
          <div class="publicados">
            <div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">15</span></div>
            <div class="campo"><span class="rotulo">Valor estimado (unitário)</span><span class="valor">R$ 67,4100</span></div>
          </div>
          <button class="seta" title="Mostrar detalhes do item"><svg></svg></button>
        </div>
        <div class="detalhes">
          <label>Valor unitário (R$)</label><input id="vu1" class="entrada ng-pristine" />
          <div class="campo"><span class="rotulo">Valor total</span><span class="valor" id="total1">R$ 0,0000</span></div>
          <label>Marca/Fabricante</label><input id="mf1" class="entrada" />
          <label>Modelo/Versão</label><input id="mv1" class="entrada" />
          <button type="button" class="mini br-button ml-2 mb-1 ng-star-inserted">Salvar</button>
        </div>
      </section>
    </body></html>`;

    const eventos = { salvamentos: [], teclas: [], valorInicialFormatado: false };
    const formatarMoeda = (digitos) => (Number(digitos || "0") / 10000).toLocaleString("pt-BR", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    });
    const atualizarTotal = (w, valor) => {
      w.document.getElementById("total1").textContent = `R$ ${(valor * 15).toLocaleString("pt-BR", {
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
      })}`;
    };
    const { window, enviar } = montarPagina(html, {
      preparar: (w) => {
        const campo = w.document.getElementById("vu1");
        campo.addEventListener("keydown", (event) => {
          eventos.teclas.push(event.key);
          if (/^\d$/.test(event.key || "") && !eventos.valorInicialFormatado) {
            // Reproduz a máscara observada: o primeiro 6 vira o visual 6,0000;
            // as próximas teclas keydown não mudam o value do campo.
            campo.value = `${event.key},0000`;
            eventos.valorInicialFormatado = campo.value === "6,0000";
          }
        });
        campo.addEventListener("input", () => {
          // O componente lê o texto recebido: se o bot concatenar ao visual
          // "6,0000", os zeros decimais viram novos dígitos (674.100,0000).
          const digitos = campo.value.replace(/\D/g, "");
          campo.value = formatarMoeda(digitos);
          campo.className = "entrada ng-dirty ng-touched ng-valid";
          const valor = Number(campo.value.replace(/\./g, "").replace(",", ".")) || 0;
          atualizarTotal(w, valor);
        });
        w.document.querySelector(".seta").addEventListener("click", () => {
          w.document.querySelector(".detalhes").style.display = "block";
        });
        const botao = w.document.querySelector("button.br-button");
        botao.addEventListener("click", () => {
          const valor = campo.value;
          eventos.salvamentos.push({ valor, total: w.document.getElementById("total1").textContent });
          const toast = w.document.createElement("div");
          toast.setAttribute("role", "alert");
          toast.textContent = "Item salvo com sucesso";
          w.document.querySelector("section[data-item='1']").appendChild(toast);
        });
      },
    });

    const r = await enviar({
      action: "fill_items",
      delay: 20,
      items: [{ item: 1, valorUnitario: "67,4100", marcaFabricante: "ACME", modeloVersao: "Modelo 1" }],
    });
    const campo = window.document.getElementById("vu1");
    const total = window.document.getElementById("total1").textContent;
    checar(eventos.valorInicialFormatado, "a máscara exibiu 6,0000 imediatamente após a primeira tecla 6");
    checar(campo.value === "67,4100", `prefixo cru evitou casas extras e manteve 67,4100 (${campo.value})`);
    checar(total === "R$ 1.011,1500", `total calculado corretamente (${total})`);
    checar(eventos.salvamentos.length === 1 && eventos.salvamentos[0]?.valor === "67,4100", `clicou no botão br-button Salvar com preço correto (${JSON.stringify(eventos.salvamentos)})`);
    checar(eventos.salvamentos[0]?.total === "R$ 1.011,1500", "o item foi salvo depois do total correto");
    checar(r.filled === 1 && JSON.stringify(r.savedItems) === "[1]" && r.salvamentos[0]?.confirmado, "item confirmado no relatório de salvamento");
    checar(r.salvamentos[0]?.botao === "Salvar", `reconheceu o nome do botão (${r.salvamentos[0]?.botao})`);
    checar(r.salvamentos[0]?.lancamentos?.valorUnitario === 1, "valor unitário lançado uma única vez");
    checar(window.document.getElementById("mf1").value === "ACME" && window.document.getElementById("mv1").value === "Modelo 1", "preencheu marca e modelo depois do preço");
    checar(!eventos.teclas.includes("Backspace"), "não enviou Backspace extra depois que a máscara já reagiu ao keydown");
  }

  console.log("\n── 26) Botão br-button sem texto DOM é encontrado pelo nome acessível ──");
  {
    const html = `<!DOCTYPE html><html><body>
      <section class="item" data-item="1">
        <div class="cabecalho">
          <div class="numero">1</div><div class="titulo">ITEM 1</div>
          <div class="publicados">
            <div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">15</span></div>
            <div class="campo"><span class="rotulo">Valor estimado (unitário)</span><span class="valor">R$ 67,4100</span></div>
          </div>
          <button class="seta" title="Mostrar detalhes do item"><svg></svg></button>
        </div>
        <div class="detalhes">
          <label>Valor unitário (R$)</label><input id="vu1" />
          <label>Marca/Fabricante</label><input id="mf1" />
          <label>Modelo/Versão</label><input id="mv1" />
          <span id="rotulo-botao-salvar" hidden>Salvar</span>
          <button type="button" class="mini br-button ml-2 mb-1 ng-star-inserted" aria-labelledby="rotulo-botao-salvar"><svg></svg></button>
        </div>
      </section>
    </body></html>`;
    const eventos = { cliques: 0 };
    const { window, enviar } = montarPagina(html, {
      preparar: (w) => {
        w.document.querySelector("button.br-button").addEventListener("click", () => {
          eventos.cliques += 1;
          const toast = w.document.createElement("div");
          toast.setAttribute("role", "alert");
          toast.textContent = "Item salvo com sucesso";
          w.document.querySelector("section.item").appendChild(toast);
        });
      },
    });
    const r = await enviar({
      action: "fill_items",
      delay: 20,
      items: [{ item: 1, valorUnitario: "67,4100", marcaFabricante: "ACME", modeloVersao: "Modelo 1" }],
    });
    checar(eventos.cliques === 1, `clicou no botão pelo nome acessível “Salvar” (${eventos.cliques})`);
    checar(r.salvamentos[0]?.botao === "Salvar" && r.salvamentos[0]?.confirmado, "relatório reconheceu e confirmou o botão sem texto interno");
    checar(window.document.querySelector("#vu1").value === "67,4100", "manteve o valor unitário exato ao localizar o botão");
  }

  return falhas;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const falhas = await rodarSalvar();
  console.log(falhas ? `\n💥 ${falhas} falha(s)` : "\n🎉 Salvamento OK");
  process.exitCode = falhas ? 1 : 0;
}
