/**
 * Harness da PAGINAÇÃO (jsdom) — o ComprasNet mostra 10 itens por página.
 *
 * Simula o portal com 15 itens: página 1 (itens 1–10) e página 2 (itens 11–15),
 * com paginação « ‹ 1 2 › » e o coração "Adicionar aos favoritos" em cada item.
 *
 * Valida que a extensão:
 *  1) lê os itens de TODAS as páginas (1 e 2) e volta para a primeira;
 *  2) preenche e salva um item que está na página 2 (navegando até ele);
 *  3) nunca clica no Favoritos.
 *
 * Uso: node tests/extensao-harness/paginacao.mjs
 */
import { montarPagina, conferir } from "./harness.mjs";

const TOTAL_ITENS = 15;
const POR_PAGINA = 10;

function paginaPaginada() {
  const itens = Array.from({ length: TOTAL_ITENS }, (_, i) => i + 1);

  const itemHtml = (n) => `
    <section class="item" data-item="${n}">
      <div class="cabecalho">
        <div class="numero">${n}</div>
        <div class="titulo">ITEM ${n}</div>
        <div class="campos-publicados">
          <div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">10</span></div>
          <div class="campo"><span class="rotulo">Unidade fornecimento</span><span class="valor">Unidade</span></div>
          <div class="campo"><span class="rotulo">Valor estimado (unitário)</span><span class="valor">R$ 44,0000</span></div>
          <div class="campo"><span class="valor alerta">Proposta não cadastrada</span></div>
        </div>
        <div class="acoes">
          <button class="favoritar" aria-label="Adicionar aos favoritos"><svg></svg></button>
          <button class="seta" aria-label="Mostrar detalhes do item" title="Mostrar detalhes do item"><svg></svg></button>
        </div>
      </div>
      <div class="detalhes" style="display:none">
        <p class="descricao-detalhada">DESCRIÇÃO DETALHADA DO ITEM ${n}</p>
        <div class="campos">
          <label>Valor unitário (R$)</label><input id="vu${n}" class="entrada" />
          <label>Marca/Fabricante</label><input id="mf${n}" class="entrada" />
          <label>Modelo/Versão</label><input id="mv${n}" class="entrada" />
        </div>
        <div class="rodape"><button id="salvar${n}" class="btn btn-primary">Salvar</button></div>
      </div>
    </section>`;

  return `<!DOCTYPE html><html><body>
    <h2>Itens</h2>
    <div id="lista"></div>
    <nav class="pagination" aria-label="Paginação">
      <button id="pg-anterior" aria-label="Página anterior">«</button>
      <button id="pg-1" class="page active" aria-current="page">1</button>
      <button id="pg-2" class="page">2</button>
      <button id="pg-proximo" aria-label="Próxima página">»</button>
    </nav>
    <script>
      const ITENS = ${JSON.stringify(itens)};
      const POR_PAGINA = ${POR_PAGINA};
      const itemHtml = ${itemHtml.toString()};
      const estado = { pagina: 1 };

      function render() {
        const inicio = (estado.pagina - 1) * POR_PAGINA;
        document.getElementById("lista").innerHTML = ITENS
          .slice(inicio, inicio + POR_PAGINA)
          .map((n) => itemHtml(n))
          .join("");

        document.querySelectorAll(".pagination .page").forEach((b) => {
          const ativa = Number(b.textContent) === estado.pagina;
          b.classList.toggle("active", ativa);
          b.setAttribute("aria-current", ativa ? "page" : "false");
        });

        document.querySelectorAll(".favoritar").forEach((b) =>
          b.addEventListener("click", () => { window.__favoritos = (window.__favoritos || 0) + 1; }),
        );
        document.querySelectorAll(".seta").forEach((b) =>
          b.addEventListener("click", () => {
            b.closest(".item").querySelector(".detalhes").style.display = "block";
          }),
        );
        document.querySelectorAll("[id^='salvar']").forEach((b) =>
          b.addEventListener("click", () => {
            const numero = b.id.replace("salvar", "");
            window.__salvos = (window.__salvos || []).concat(numero);
            const aviso = document.createElement("div");
            aviso.setAttribute("role", "alert");
            aviso.className = "alert alert-success";
            aviso.textContent = "Item salvo com sucesso";
            b.closest(".item").appendChild(aviso);
          }),
        );
      }

      window.__pagina = () => estado.pagina;
      const irPara = (n) => {
        if (n < 1 || n > Math.ceil(ITENS.length / POR_PAGINA) || n === estado.pagina) return;
        estado.pagina = n;
        render();
      };
      document.getElementById("pg-1").addEventListener("click", () => irPara(1));
      document.getElementById("pg-2").addEventListener("click", () => irPara(2));
      document.getElementById("pg-proximo").addEventListener("click", () => irPara(estado.pagina + 1));
      document.getElementById("pg-anterior").addEventListener("click", () => irPara(estado.pagina - 1));

      render();
    </script>
  </body></html>`;
}

export async function rodarPaginacao() {
  let falhas = 0;
  const checar = (c, m) => { if (!c) falhas += 1; conferir(c, m); };

  console.log("\n── 1) Ler itens de todas as páginas ──");
  {
    const { window, enviar } = montarPagina(paginaPaginada());
    const r = await enviar({ action: "read_comprasnet_items", expandir: true, delay: 10 });

    checar(r.ok === true, `leitura ok (${r.error || "sem erro"})`);
    checar(r.total === TOTAL_ITENS, `leu os ${TOTAL_ITENS} itens das 2 páginas (${r.total})`);
    checar(r.paginas === 2, `páginas lidas: ${r.paginas}`);
    const numeros = (r.itens || []).map((i) => i.numeroItem);
    checar(
      JSON.stringify(numeros) === JSON.stringify(Array.from({ length: TOTAL_ITENS }, (_, i) => String(i + 1))),
      `números em ordem (${numeros.join(",")})`,
    );
    checar((r.itens || []).every((i) => !/favorit/i.test(i.descricao || "")), "nenhuma descrição veio do Favoritos");
    checar((window.__favoritos || 0) === 0, `não clicou em Favoritos (${window.__favoritos || 0})`);
    checar(window.__pagina() === 1, `voltou para a primeira página (${window.__pagina()})`);
  }

  console.log("\n── 2) Preencher item que está na página 2 ──");
  {
    const { window, enviar } = montarPagina(paginaPaginada());
    const r = await enviar({
      action: "fill_items",
      delay: 20,
      items: [
        { item: 11, valorUnitario: "162,9900", marcaFabricante: "Conforme TR", modeloVersao: "Conforme TR" },
        { item: 3, valorUnitario: "44,0000", marcaFabricante: "ACME", modeloVersao: "X1" },
      ],
    });

    checar(r.filled === 2, `preencheu os 2 itens (${r.filled})`);
    // Mesmo chegando fora de ordem (11 e 3), o bot preenche na ordem do ITEM:
    // 3 (na página 1) primeiro e depois 11 (na página 2).
    checar(
      JSON.stringify(window.__salvos || []) === JSON.stringify(["3", "11"]),
      `preencheu na ordem do item: 3 e depois 11 — ${JSON.stringify(window.__salvos)}`,
    );
    checar(JSON.stringify(r.savedItems) === JSON.stringify([3, 11]), `savedItems = ${JSON.stringify(r.savedItems)}`);
    checar(r.salvamentos.every((s) => s.confirmado && !s.recusado), "todos confirmados pelo site");
    checar((window.__favoritos || 0) === 0, `não clicou em Favoritos (${window.__favoritos || 0})`);
    checar(
      window.document.getElementById("vu11") === null || window.__pagina() === 2,
      "o item 11 está na página 2 quando foi preenchido",
    );
  }

  console.log("\n── 3) Item que não existe em página nenhuma ──");
  {
    const { window, enviar } = montarPagina(paginaPaginada());
    const r = await enviar({
      action: "fill_items",
      delay: 20,
      items: [{ item: 99, valorUnitario: "10,0000", marcaFabricante: "ACME", modeloVersao: "" }],
    });
    checar(r.filled === 0 && /não está na página/.test(r.errors?.[0] || ""), `erro claro: "${r.errors?.[0]}"`);
    checar((window.__favoritos || 0) === 0, "não clicou em Favoritos");
  }

  return falhas;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const falhas = await rodarPaginacao();
  console.log(falhas ? `\n💥 ${falhas} falha(s)` : "\n🎉 Paginação OK");
  process.exitCode = falhas ? 1 : 0;
}
