/**
 * Harness do PAINEL FLUTUANTE e dos controles Pausar/Parar (jsdom).
 *
 * O popup do Chrome fecha quando o usuário clica fora; o painel vive na página
 * do ComprasNet e precisa: aparecer, pausar de verdade (sem salvar os itens
 * seguintes) e parar o bot.
 *
 * Uso: node tests/extensao-harness/painel.mjs
 */
import { montarPagina, conferir } from "./harness.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Página com N itens prontos para preencher (cada um com seu Salvar). */
function paginaComItens(n = 3) {
  const item = (i) => `
    <section class="item" data-item="${i}">
      <div class="cabecalho">
        <div class="numero">${i}</div>
        <div class="titulo">ITEM ${i}</div>
        <div class="publicados">
          <div class="campo"><span class="rotulo">Quantidade solicitada</span><span class="valor">10</span></div>
          <div class="campo"><span class="rotulo">Valor estimado (unitário)</span><span class="valor">R$ 44,0000</span></div>
        </div>
        <button class="seta" title="Mostrar detalhes do item"><svg></svg></button>
      </div>
      <div class="detalhes" style="display:none">
        <div class="campos">
          <label>Valor unitário (R$)</label><input id="vu${i}" class="entrada" />
          <label>Marca/Fabricante</label><input id="mf${i}" class="entrada" />
          <label>Modelo/Versão</label><input id="mv${i}" class="entrada" />
        </div>
        <div class="rodape"><button id="salvar${i}" class="btn btn-primary">Salvar</button></div>
      </div>
    </section>`;

  return `<!DOCTYPE html><html><body>
    <h2>Itens</h2>
    <div id="lista">${Array.from({ length: n }, (_, k) => item(k + 1)).join("\n")}</div>
  </body></html>`;
}

function ambiente(n = 3) {
  const salvos = [];
  const { window, enviar } = montarPagina(paginaComItens(n), {
    preparar: (w) => {
      w.document.querySelectorAll(".seta").forEach((b) =>
        b.addEventListener("click", () => {
          b.closest(".item").querySelector(".detalhes").style.display = "block";
        }),
      );
      w.document.querySelectorAll("[id^='salvar']").forEach((b) =>
        b.addEventListener("click", () => {
          salvos.push(b.id);
          const aviso = w.document.createElement("div");
          aviso.setAttribute("role", "alert");
          aviso.className = "alert alert-success";
          aviso.textContent = "Item salvo com sucesso";
          b.closest(".item").appendChild(aviso);
        }),
      );
    },
  });
  return { window, enviar, salvos };
}

const itens = (n) =>
  Array.from({ length: n }, (_, k) => ({
    item: k + 1,
    valorUnitario: "44,0000",
    marcaFabricante: "ACME",
    modeloVersao: "X1",
  }));

export async function rodarPainel() {
  let falhas = 0;
  const checar = (c, m) => { if (!c) falhas += 1; conferir(c, m); };

  console.log("\n── 1) Painel flutuante na página ──");
  {
    const { window, enviar } = ambiente(2);
    checar(!window.document.getElementById("__comprasnet_bot_painel__"), "não existe painel antes de pedir");

    const r = await enviar({ action: "painel_mostrar" });
    const painel = window.document.getElementById("__comprasnet_bot_painel__");
    checar(r.ok === true && Boolean(painel), "mostrou o painel na página");
    checar(
      /Pausar/.test(painel?.textContent || "") && /Parar/.test(painel?.textContent || ""),
      "o painel tem os botões Pausar e Parar",
    );
    checar(
      painel?.style.position === "fixed",
      `o painel é flutuante (position: ${painel?.style.position})`,
    );

    // Clicar em Pausar no próprio painel:
    window.document.getElementById("__comprasnet_bot_painel___pausar").click();
    const estado = await enviar({ action: "status" });
    checar(estado.pausado === true, "o botão do painel pausa o bot");
    checar(/Pausado/.test(painel.textContent), "o painel mostra que está pausado");

    window.document.getElementById("__comprasnet_bot_painel___pausar").click();
    const estado2 = await enviar({ action: "status" });
    checar(estado2.pausado === false, "clicar de novo retoma o bot");

    window.document.getElementById("__comprasnet_bot_painel___fechar").click();
    checar(!window.document.getElementById("__comprasnet_bot_painel__"), "dá para fechar o painel");
  }

  console.log("\n── 2) Pausar no meio: não salva os itens seguintes ──");
  {
    const { window, enviar, salvos } = ambiente(3);

    const rodando = enviar({ action: "fill_items", delay: 300, items: itens(3) });
    const esperarAte = async (condicao, tempoMs = 6000) => {
      const limite = Date.now() + tempoMs;
      while (Date.now() < limite) {
        if (condicao()) return true;
        await sleep(150);
      }
      return condicao();
    };
    await esperarAte(() => salvos.length >= 1); // deixa o item 1 ser salvo

    const salvosAntesDaPausa = salvos.length;
    await enviar({ action: "pause" });
    await sleep(1400); // tempo de sobra para os itens 2 e 3, se não pausasse

    checar(salvosAntesDaPausa >= 1, `o item 1 foi salvo antes da pausa (${salvosAntesDaPausa})`);
    checar(
      salvos.length === salvosAntesDaPausa,
      `nada foi salvo durante a pausa (seguia em ${salvosAntesDaPausa}, ficou ${salvos.length})`,
    );
    const estado = await enviar({ action: "status" });
    checar(estado.pausado === true, "status da página: pausado");

    await enviar({ action: "resume" });
    const r = await rodando;
    checar(r.filled === 3, `retomou e preencheu os 3 itens (${r.filled})`);
    checar(salvos.length === 3, `os 3 itens foram salvos (${JSON.stringify(salvos)})`);
    checar(JSON.stringify(r.savedItems) === JSON.stringify([1, 2, 3]), `savedItems = ${JSON.stringify(r.savedItems)}`);
  }

  console.log("\n── 3) Parar no meio: interrompe de vez ──");
  {
    const { window, enviar, salvos } = ambiente(4);

    const rodando = enviar({ action: "fill_items", delay: 300, items: itens(4) });
    await sleep(900);
    const antes = salvos.length;
    await enviar({ action: "stop" });
    const r = await rodando;

    checar(r.aborted === true, "o resultado veio marcado como interrompido");
    checar(r.filled < 4, `não preencheu todos (${r.filled} de 4)`);
    checar(salvos.length <= antes + 1, `parou de salvar (${antes} → ${salvos.length})`);
    checar(
      salvos.length === r.savedItems.length,
      `savedItems bate com o que foi salvo (${r.savedItems.length})`,
    );
  }

  console.log("\n── 4) Pausado durante a leitura ──");
  {
    const { enviar } = ambiente(3);
    const lendo = enviar({ action: "read_comprasnet_items", expandir: true, delay: 250 });
    await sleep(120);
    await enviar({ action: "pause" });
    await sleep(700);
    const estado = await enviar({ action: "status" });
    checar(estado.pausado === true, "leitura pausada");
    await enviar({ action: "resume" });
    const r = await lendo;
    checar(r.total === 3, `leitura concluída depois de retomar (${r.total} itens)`);
  }

  console.log("\n── 5) Escolher proposta no painel e Iniciar ──");
  {
    const { window, enviar, salvos } = ambiente(3);
    window.__armazenamento.apiUrl = "https://app.exemplo.com";

    const chamadas = [];
    const propostas = [
      {
        id: 7,
        numeroDispensa: "UASG 123456 - 45/2026",
        uasg: "123456",
        totalItens: 3,
        itensPreenchidos: 3,
        itensEnviados: 0,
      },
    ];
    const itensDaProposta = [
      { id: 101, item: 1, valorUnitario: "44,0000", marcaFabricante: "ACME", modeloVersao: "X1" },
      { id: 102, item: 2, valorUnitario: "45,5000", marcaFabricante: "ACME", modeloVersao: "X2" },
      { id: 103, item: 3, valorUnitario: "46,2500", marcaFabricante: "ACME", modeloVersao: "X3" },
    ];

    window.fetch = async (url, opcoes = {}) => {
      chamadas.push(`${opcoes.method || "GET"} ${url}`);
      if (String(url).endsWith("/api/propostas")) {
        return { ok: true, status: 200, json: async () => propostas };
      }
      if (String(url).includes("/script")) {
        return { ok: true, status: 200, json: async () => ({ itens: itensDaProposta }) };
      }
      if (opcoes.method === "PUT") {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    await enviar({ action: "painel_mostrar" });
    await sleep(300);

    const select = window.document.getElementById("__comprasnet_bot_painel___proposta");
    checar(select?.options.length === 1, `o painel listou a proposta (${select?.options.length} opção(ões))`);
    checar(/45\/2026/.test(select?.options[0]?.textContent || ""), `com identificação ("${select?.options[0]?.textContent}")`);

    select.value = "7";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
    window.document.getElementById("__comprasnet_bot_painel___iniciar").click();

    // Espera o fim (o bot preenche/salva item por item, isso leva alguns segundos).
    const limite = Date.now() + 60000;
    const puts = () => chamadas.filter((c) => c.startsWith("PUT") && c.includes("/itens/")).length;
    while (Date.now() < limite && puts() < 3) await sleep(250);

    checar(
      chamadas.some((c) => c.includes("/api/propostas/7/script")),
      "buscou os itens da proposta escolhida",
    );
    checar(salvos.length === 3, `preencheu e salvou os 3 itens (${JSON.stringify(salvos)})`);
    checar(
      chamadas.filter((c) => c.startsWith("PUT") && c.includes("/itens/")).length === 3,
      `marcou os 3 como enviados (${chamadas.filter((c) => c.startsWith("PUT")).length})`,
    );
    const status = window.document.getElementById("__comprasnet_bot_painel___status").textContent;
    checar(/3\/3/.test(status) || /3/.test(status), `o painel mostra o resultado ("${status}")`);
  }

  return falhas;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const falhas = await rodarPainel();
  console.log(falhas ? `\n💥 ${falhas} falha(s)` : "\n🎉 Painel e pausa OK");
  process.exitCode = falhas ? 1 : 0;
}
