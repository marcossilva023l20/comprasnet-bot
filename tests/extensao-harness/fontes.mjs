import assert from "node:assert/strict";
import { montarPagina, conferir } from "./harness.mjs";

let falhas = 0;
function checar(condicao, mensagem) {
  if (!condicao) falhas += 1;
  conferir(condicao, mensagem);
}

export async function rodarFontes() {
  console.log("\n── 1) CNET Mobile: ler a compra acompanhada e expandir detalhes do item ──");
  {
    const html = `<!doctype html><html><body>
      <main>
        <div class="pesquisa">
          <label for="unidade">Unidade compradora</label><input id="unidade" value="795140">
          <label for="compra">Número da compra</label><input id="compra" value="25/2026">
          <p>Objeto: Aquisição de equipamentos de áudio para teste</p>
        </div>
        <h2>Itens da compra</h2>
        <table>
          <thead><tr>
            <th>Item</th><th>Descrição</th><th>Quantidade solicitada</th>
            <th>Unidade de fornecimento</th><th>Valor estimado unitário</th>
          </tr></thead>
          <tbody>
            <tr id="item-1">
              <td>1</td>
              <td><span>FONE OUVIDO</span><button id="detalhar-1" aria-label="Mostrar detalhes do item" aria-expanded="false">Mostrar detalhes do item</button></td>
              <td>2</td><td>Unidade</td><td>R$ 67,4100</td>
            </tr>
            <tr id="detalhe-1" style="display:none"><td colspan="5"><span>Descrição detalhada: fone intra auricular com microfone e conector P2</span></td></tr>
          </tbody>
        </table>
      </main>
    </body></html>`;
    const { window, enviar } = montarPagina(html, {
      url: "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras",
      preparar: (w) => {
        w.document.getElementById("detalhar-1").addEventListener("click", (event) => {
          event.currentTarget.setAttribute("aria-expanded", "true");
          w.document.getElementById("detalhe-1").style.display = "table-row";
        });
      },
    });

    const resultado = await enviar({ action: "read_source_items", expandir: true, delay: 0 });
    checar(resultado.ok, `leitura do CNET Mobile concluiu (${resultado.error || "sem erro"})`);
    checar(resultado.origem === "Compras.gov.br / CNET Mobile", `identificou a fonte (${resultado.origem})`);
    checar(resultado.itens?.length === 1, `leu o item da compra (${resultado.itens?.length})`);
    checar(resultado.itens?.[0]?.numeroItem === "1", `número do item preservado (${resultado.itens?.[0]?.numeroItem})`);
    checar(resultado.itens?.[0]?.descricao === "FONE OUVIDO", `descrição resumida sem texto do botão (${resultado.itens?.[0]?.descricao})`);
    checar(resultado.itens?.[0]?.quantidade === "2", `quantidade lida (${resultado.itens?.[0]?.quantidade})`);
    checar(resultado.itens?.[0]?.unidade === "Unidade", `unidade lida (${resultado.itens?.[0]?.unidade})`);
    checar(resultado.itens?.[0]?.valorEstimado === "R$ 67,4100", `valor estimado lido (${resultado.itens?.[0]?.valorEstimado})`);
    checar(/fone intra auricular/i.test(resultado.itens?.[0]?.descricaoDetalhada || ""), "descrição detalhada veio do painel aberto");
    checar(resultado.expandidos === 1, `abriu “Mostrar detalhes do item” (${resultado.expandidos})`);
    checar(resultado.identificacao?.uasg === "795140", `UASG lida da pesquisa (${resultado.identificacao?.uasg})`);
    checar(resultado.identificacao?.numeroCompra === "25/2026", `número da compra lido (${resultado.identificacao?.numeroCompra})`);
    window.close();
  }

  console.log("\n── 2) CNET Mobile: captura detalhes em modal e fecha para continuar a lista ──");
  {
    const html = `<!doctype html><html><body>
      <main><table>
        <thead><tr><th>Item</th><th>Descrição</th><th>Quantidade</th><th>Unidade</th></tr></thead>
        <tbody>
          <tr><td>1</td><td>FONE OUVIDO<button id="detalhar-1">Mostrar detalhes do item</button></td><td>2</td><td>Unidade</td></tr>
          <tr><td>2</td><td>MICROFONE<button id="detalhar-2">Mostrar detalhes do item</button></td><td>1</td><td>Unidade</td></tr>
        </tbody>
      </table></main>
      <div id="detalhe-modal" role="dialog" style="display:none">
        <h2 id="titulo-modal"></h2>
        <p id="descricao-modal"></p>
        <button id="fechar-modal" aria-label="Fechar">Fechar</button>
      </div>
    </body></html>`;
    const { window, enviar } = montarPagina(html, {
      url: "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras",
      preparar: (w) => {
        for (const numero of [1, 2]) {
          w.document.getElementById(`detalhar-${numero}`).addEventListener("click", () => {
            w.document.getElementById("titulo-modal").textContent = `Detalhes do item ${numero}`;
            w.document.getElementById("descricao-modal").textContent = `Descrição detalhada: especificação técnica do item ${numero} para validação`;
            w.document.getElementById("detalhe-modal").style.display = "block";
          });
        }
        w.document.getElementById("fechar-modal").addEventListener("click", () => {
          w.document.getElementById("detalhe-modal").style.display = "none";
        });
      },
    });

    const resultado = await enviar({ action: "read_source_items", expandir: true, delay: 0 });
    checar(resultado.ok, `leitura com modal concluiu (${resultado.error || "sem erro"})`);
    checar(resultado.itens?.length === 2, `leu os dois itens (${resultado.itens?.length})`);
    checar(/item 1 para validação/i.test(resultado.itens?.[0]?.descricaoDetalhada || ""), "capturou a descrição do primeiro modal");
    checar(/item 2 para validação/i.test(resultado.itens?.[1]?.descricaoDetalhada || ""), "capturou a descrição do segundo modal");
    checar(window.document.getElementById("detalhe-modal").style.display === "none", "fechou cada modal para continuar na lista");
    checar(resultado.expandidos === 2, `abriu os dois detalhes (${resultado.expandidos})`);
    window.close();
  }

  console.log("\n── 3) Radar PNCP: ler a tabela “Itens da contratação” ──");
  {
    const html = `<!doctype html><html><body>
      <article class="resultado"><p>UASG 111111</p><p>Nº / ano</p><p>99/2099</p></article>
      <div class="fixed inset-0 z-50">
        <div class="relative">
          <header><h2>Fornecimento de material de expediente</h2></header>
          <section class="identificacao">
            <div><p>Nº da compra / ano</p><p>25/2026</p></div>
            <div><p>UASG</p><p>795140</p></div>
            <div><p>Encerramento das propostas</p><p>30/11/2026</p></div>
          </section>
          <section>
            <div class="mb-2 flex items-center justify-between"><h4>Itens da contratação</h4></div>
          <div class="overflow-x-auto"><table>
            <thead><tr><th>#</th><th>Descrição</th><th>Qtd.</th><th>Unid.</th><th>Vl. unitário</th><th>Vl. total</th></tr></thead>
            <tbody><tr><td>3</td><td>PAPEL A4 RECICLADO</td><td>10</td><td>Resma</td><td>R$ 28,90</td><td>R$ 289,00</td></tr></tbody>
          </table></div>
          </section>
        </div>
      </div>
    </body></html>`;
    const { window, enviar } = montarPagina(html, {
      url: "https://marcossilva023l20.github.io/radar-licitacoes-v2/",
    });

    const resultado = await enviar({ action: "read_source_items", expandir: false, delay: 0 });
    checar(resultado.ok, `leitura do Radar concluiu (${resultado.error || "sem erro"})`);
    checar(resultado.origem === "Radar de Licitações PNCP", `identificou a fonte (${resultado.origem})`);
    checar(resultado.itens?.length === 1, `leu a tabela de itens (${resultado.itens?.length})`);
    checar(resultado.itens?.[0]?.numeroItem === "3", `número do item preservado (${resultado.itens?.[0]?.numeroItem})`);
    checar(resultado.itens?.[0]?.descricao === "PAPEL A4 RECICLADO", `descrição lida (${resultado.itens?.[0]?.descricao})`);
    checar(resultado.itens?.[0]?.quantidade === "10", `quantidade lida (${resultado.itens?.[0]?.quantidade})`);
    checar(resultado.itens?.[0]?.unidade === "Resma", `unidade lida (${resultado.itens?.[0]?.unidade})`);
    checar(resultado.itens?.[0]?.valorEstimado === "R$ 28,90", `valor unitário estimado lido (${resultado.itens?.[0]?.valorEstimado})`);
    checar(resultado.identificacao?.numeroCompra === "25/2026", `número/ano reconhecido no detalhe (${resultado.identificacao?.numeroCompra})`);
    checar(resultado.identificacao?.uasg === "795140", `UASG veio do modal aberto, não do card de fundo (${resultado.identificacao?.uasg})`);
    checar(resultado.identificacao?.objeto === "Fornecimento de material de expediente", `objeto lido do modal aberto (${resultado.identificacao?.objeto})`);
    checar(resultado.identificacao?.dataLimite === "30/11/2026", `data limite lida (${resultado.identificacao?.dataLimite})`);
    window.close();
  }

  console.log("\n── 4) Radar PNCP: orienta abrir “Ver detalhes” se os itens ainda não apareceram ──");
  {
    const { window, enviar } = montarPagina("<!doctype html><html><body><button>Ver detalhes</button></body></html>", {
      url: "https://marcossilva023l20.github.io/radar-licitacoes-v2/",
    });
    const resultado = await enviar({ action: "read_source_items", expandir: false, delay: 0 });
    checar(resultado.ok === false, "não finge que encontrou itens antes de abrir os detalhes");
    checar(/Ver detalhes/.test(resultado.error || ""), `mensagem explica o próximo passo (${resultado.error})`);
    window.close();
  }

  if (falhas) throw new Error(`${falhas} verificação(ões) de leitura das fontes falharam`);
  console.log("\n🎉 Leitura de fontes adicionais OK");
}

if (process.argv[1]?.endsWith("fontes.mjs")) await rodarFontes();
