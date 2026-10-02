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
    checar(eventos.salvos.length === 1, "o clique aconteceu");
    checar(r.salvamentos[0].clicado === true && r.salvamentos[0].confirmado === false, "relatório: clicado, sem confirmação");
    checar(JSON.stringify(r.savedItems) === JSON.stringify([1]), "entra em savedItems (o clique aconteceu)");
    checar(r.warnings.some((w) => /não confirmou/.test(w)), "avisa o usuário para conferir");
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

  return falhas;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const falhas = await rodarSalvar();
  console.log(falhas ? `\n💥 ${falhas} falha(s)` : "\n🎉 Salvamento OK");
  process.exitCode = falhas ? 1 : 0;
}
