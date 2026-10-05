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

  console.log("\n── 2) CNET Mobile: lê o cartão/accordion real com “Qtde solicitada” ──");
  {
    const html = `<!doctype html><html><body>
      <main>
        <h1>Acompanhar Contratação</h1>
        <p>Dispensa Eletrônica Nº 25/2026 (Lei 14.133/2021)</p>
        <p>UASG 795140 - 3.BATALHÃO DE INFANTARIA DE FUZILEIROS NAVAIS</p>
        <div class="item-card" data-item="1">
          <div class="item-heading">
            <span>1</span><span>MÓDULO MEMÓRIA</span>
            <button id="expandir-item" aria-label="Expandir detalhes do item 1" aria-expanded="false"><svg class="chevron-down"></svg></button>
          </div>
          <div class="resumo">
            <div><span>Qtde solicitada</span><span>8</span></div>
            <div><span>Valor estimado (unitário)</span><span>R$ 176,0000</span></div>
          </div>
          <div id="detalhes-item" class="accordion" style="display:none">
            <div><span>Unidade de fornecimento</span><span>UNIDADE</span></div>
            <div><span>Descrição detalhada</span><span>Módulo de memória para computador, capacidade compatível com o equipamento.</span></div>
          </div>
        </div>
      </main>
    </body></html>`;
    const { window, enviar } = montarPagina(html, {
      url: "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=79514006000252026",
      preparar: (w) => {
        w.document.getElementById("expandir-item").addEventListener("click", (event) => {
          event.currentTarget.setAttribute("aria-expanded", "true");
          w.document.getElementById("detalhes-item").style.display = "block";
        });
      },
    });

    const resultado = await enviar({ action: "read_source_items", expandir: true, delay: 0 });
    checar(resultado.ok, `leitura do cartão CNET concluiu (${resultado.error || "sem erro"})`);
    checar(resultado.itens?.length === 1, `leu o cartão do item (${resultado.itens?.length})`);
    checar(resultado.itens?.[0]?.numeroItem === "1", `número do cartão preservado (${resultado.itens?.[0]?.numeroItem})`);
    checar(resultado.itens?.[0]?.descricao === "MÓDULO MEMÓRIA", `descrição do cabeçalho lida (${resultado.itens?.[0]?.descricao})`);
    checar(resultado.itens?.[0]?.quantidade === "8", `Qtde solicitada lida (${resultado.itens?.[0]?.quantidade})`);
    checar(resultado.itens?.[0]?.unidade === "UNIDADE", `unidade lida do accordion (${resultado.itens?.[0]?.unidade})`);
    checar(resultado.itens?.[0]?.valorEstimado === "R$ 176,0000", `valor estimado lido (${resultado.itens?.[0]?.valorEstimado})`);
    checar(/capacidade compatível/i.test(resultado.itens?.[0]?.descricaoDetalhada || ""), "descrição detalhada lida após expandir a seta");
    checar(resultado.identificacao?.uasg === "795140", `UASG lida (${resultado.identificacao?.uasg})`);
    checar(resultado.identificacao?.numeroCompra === "25/2026", `número da dispensa preferido ao código da URL (${resultado.identificacao?.numeroCompra})`);
    checar(resultado.expandidos === 1, `expandiu o cartão (${resultado.expandidos})`);
    window.close();
  }

  console.log("\n── 3) CNET Mobile: captura detalhes em modal e fecha para continuar a lista ──");
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

  console.log("\n── 4) Radar PNCP: ler os itens do modal real com contador no título ──");
  {
    const html = `<!doctype html><html><body>
      <article class="resultado"><p>UASG 111111</p><p>Nº / ano</p><p>99/2099</p></article>
      <div class="fixed inset-0 z-50">
        <div class="relative">
          <header>
            <h2>2.1. A Escola de Sargentos das Armas (ESA) é responsável pelo Curso de Formação e Graduação de Sargentos</h2>
            <p>00394452000103-1-021036/2026</p>
          </header>
          <section class="documentos"><p>61/2026.pdf</p></section>
          <section>
            <div class="mb-2 flex items-center justify-between"><h4>ITENS DA CONTRATAÇÃO <span>3</span></h4></div>
            <div class="overflow-x-auto"><table>
              <thead><tr><th>#</th><th>DESCRIÇÃO</th><th>QTD.</th><th>UNID.</th><th>VL. UNITÁRIO</th><th>VL. TOTAL</th></tr></thead>
              <tbody>
                <tr><td>1</td><td>Gráfico - Impressos / Plastificação / Acabamento Gráfico - Serviço de impressão colorida a laser em folha tamanho A4.</td><td>12.005</td><td>UNIDADE</td><td>R$ 1,66</td><td>R$ 19.928,30</td></tr>
                <tr><td>2</td><td>Gráfico - Impressos / Plastificação / Acabamento Gráfico - Serviço de impressão colorida a laser em folha tamanho A3.</td><td>8.005</td><td>UNIDADE</td><td>R$ 2,53</td><td>R$ 20.252,65</td></tr>
                <tr><td>3</td><td>Gráfico - Impressos / Plastificação / Acabamento Gráfico - Serviço de impressão colorida a laser em folha tamanho A3+.</td><td>4.005</td><td>UNIDADE</td><td>R$ 2,58</td><td>R$ 10.332,90</td></tr>
              </tbody>
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
    checar(resultado.itens?.length === 3, `leu os três itens do modal (${resultado.itens?.length})`);
    checar(resultado.itens?.[0]?.numeroItem === "1", `número do primeiro item preservado (${resultado.itens?.[0]?.numeroItem})`);
    checar(/impressos.*tamanho A4/i.test(resultado.itens?.[0]?.descricao || ""), `descrição do primeiro item lida (${resultado.itens?.[0]?.descricao})`);
    checar(resultado.itens?.[0]?.quantidade === "12.005", `quantidade do primeiro item lida (${resultado.itens?.[0]?.quantidade})`);
    checar(resultado.itens?.[0]?.unidade === "UNIDADE", `unidade lida (${resultado.itens?.[0]?.unidade})`);
    checar(resultado.itens?.[0]?.valorEstimado === "R$ 1,66", `valor unitário lido (${resultado.itens?.[0]?.valorEstimado})`);
    checar(resultado.identificacao?.numeroCompra === "00394452000103-1-021036/2026", `controle PNCP lido do modal, não o card de fundo (${resultado.identificacao?.numeroCompra})`);
    checar(resultado.identificacao?.uasg === "", `não reaproveitou UASG de outro card (${resultado.identificacao?.uasg})`);
    checar(resultado.identificacao?.objeto?.startsWith("2.1. A Escola de Sargentos"), `objeto lido do cabeçalho do modal (${resultado.identificacao?.objeto})`);
    window.close();
  }

  console.log("\n── 5) Radar PNCP: lê compra e UASG nos rótulos reais do modal ──");
  {
    const html = `<!doctype html><html><body>
      <article class="resultado"><p>UASG 111111</p><p>Nº / ano</p><p>99/2099</p></article>
      <div class="fixed inset-0 z-50">
        <div class="relative">
          <header>
            <h2>Aquisição de material de refrigeração</h2>
            <p>00394429000100-1-002494/2026</p>
          </header>
          <section class="identificacao">
            <div><p>Nº DA COMPRA / ANO</p><p>80 / 2026</p></div>
            <div><p>PROCESSO</p><p>67293.007268/2026-42</p></div>
            <div><p>Nº UASG (UNIDADE COMPRADORA)</p><p>120641</p></div>
          </section>
          <section>
            <h4>ITENS DA CONTRATAÇÃO<span>43</span></h4>
            <table>
              <thead><tr><th>#</th><th>DESCRIÇÃO</th><th>QTD.</th><th>UNID.</th><th>VL. UNITÁRIO</th><th>VL. TOTAL</th></tr></thead>
              <tbody>
                <tr><td>1</td><td>Tubo Cobre, Tipo: Flexível Sem Costura, Aplicação: Refrigeração, Diâmetro Nominal: 1/4 POL.</td><td>300</td><td>Metro</td><td>R$ 22,79</td><td>R$ 6.837,00</td></tr>
                <tr><td>2</td><td>Tubo Cobre, Tipo: Redondo, Aplicação: Refrigeração, Diâmetro Externo: 3/8 POL.</td><td>300</td><td>Metro</td><td>R$ 39,00</td><td>R$ 11.700,00</td></tr>
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </body></html>`;
    const { window, enviar } = montarPagina(html, {
      url: "https://marcossilva023l20.github.io/radar-licitacoes-v2/",
    });

    const resultado = await enviar({ action: "read_source_items", expandir: false, delay: 0 });
    checar(resultado.ok, `leitura do modal concluiu (${resultado.error || "sem erro"})`);
    checar(resultado.itens?.length === 2, `leu os itens visíveis (${resultado.itens?.length})`);
    checar(resultado.identificacao?.numeroCompra === "80/2026", `nº da compra/ano lido, não o código PNCP (${resultado.identificacao?.numeroCompra})`);
    checar(resultado.identificacao?.uasg === "120641", `UASG lida apesar do rótulo entre parênteses (${resultado.identificacao?.uasg})`);
    checar(resultado.identificacao?.objeto === "Aquisição de material de refrigeração", `objeto lido do cabeçalho (${resultado.identificacao?.objeto})`);
    checar(resultado.itens?.[0]?.descricao?.startsWith("Tubo Cobre"), `descrição da tabela capturada (${resultado.itens?.[0]?.descricao})`);
    checar(resultado.itens?.[0]?.valorEstimado === "R$ 22,79", `valor unitário capturado (${resultado.itens?.[0]?.valorEstimado})`);
    window.close();
  }

  console.log("\n── 6) Radar PNCP: orienta abrir “Ver detalhes” se os itens ainda não apareceram ──");
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
