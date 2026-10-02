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
 * 13) Máscara de 2 casas: o bot ajusta o formato para o valor ficar certo
 * 14) Formulário tipo Angular (ng-pristine): o reforço faz o site registrar o valor
 * 15) Site recusa ("campo é obrigatório"): não conta como salvo e avisa
 * 16) Portal só contabiliza com tecla real: o Backspace do bot faz o total sair de 0,0000
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
    checar(r.salvamentos[0]?.valores?.valorUnitario === "1234,56", `relatório traz os valores da página (${JSON.stringify(r.salvamentos[0]?.valores)})`);
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

  return falhas;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const falhas = await rodarSalvar();
  console.log(falhas ? `\n💥 ${falhas} falha(s)` : "\n🎉 Salvamento OK");
  process.exitCode = falhas ? 1 : 0;
}
