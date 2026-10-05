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

function paginaDisputa({ numeroItem = 1, melhor = "128,0000", meu = "130,0000", intervalo = "1,0000", fase = "Fase de lances aberta" } = {}) {
  const intervaloVisivel = /%|R\$/i.test(intervalo) ? intervalo : `R$ ${intervalo}`;
  return `<!doctype html><html><head><title>Enviar lance</title></head><body>
    <h1>Enviar lance</h1>
    <p>Dispensa Eletrônica Nº 53/2026 (Lei 14.133/2021)</p>
    <p>UASG 781402 - ESTAÇÃO RÁDIO DA MARINHA NO RIO DE JANEIRO</p>
    <nav>Aguardando disputa · Em disputa (11) · Encerrados</nav>
    <article class="card-item" data-numero-item="${numeroItem}">
      <div><span>${numeroItem}</span> <span>TOALHA MESA</span></div>
      <p>${fase}</p>
      <div><span>Melhor valor (unitário)</span> <span id="melhor-${numeroItem}">R$ ${melhor}</span></div>
      <div><span>Meu valor (unitário)</span> <span id="meu-${numeroItem}">R$ ${meu}</span></div>
      <label for="novo-${numeroItem}">Novo lance (unitário)</label>
      <input id="novo-${numeroItem}" type="text">
      <p>Intervalo mínimo entre lances: ${intervaloVisivel}</p>
      <button id="enviar-${numeroItem}" type="button">Enviar lance</button>
    </article>
  </body></html>`;
}

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

  console.log("\n── 6) Modo Disputa: valida a licitação e envia melhor − intervalo, com piso ──");
  {
    const lances = [];
    let textoConfirmacao = "";
    const { window, enviar } = montarPagina(paginaDisputa(), {
      url: "https://www.gov.br/compras/fornecedor/enviar-lance",
      preparar: (w) => {
        w.confirm = (texto) => { textoConfirmacao = texto; return true; };
        w.document.getElementById("enviar-1").addEventListener("click", () => {
          const valor = w.document.getElementById("novo-1").value;
          lances.push(valor);
          w.document.getElementById("meu-1").textContent = `R$ ${valor}`;
          w.document.getElementById("melhor-1").textContent = `R$ ${valor}`;
        });
      },
    });
    window.__armazenamento.apiUrl = "https://app.exemplo.com";
    const propostas = [{ id: 7, numeroDispensa: "53/2026", uasg: "781402", totalItens: 1, itensPreenchidos: 1 }];
    const registro = [{ numeroItem: 1, descricao: "TOALHA MESA", valorUnitario: "130.0000", valorMinimo: "120.0000" }];
    window.fetch = async (url) => {
      const destino = String(url);
      if (destino.endsWith("/api/propostas/7/script")) {
        return { ok: true, status: 200, json: async () => ({ proposta: propostas[0], itens: [] }) };
      }
      if (destino.endsWith("/api/propostas/7/itens")) {
        return { ok: true, status: 200, json: async () => registro };
      }
      if (destino.endsWith("/api/propostas")) {
        return { ok: true, status: 200, json: async () => propostas };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const iniciado = await enviar({ action: "disputa_start", propostaId: "7" });
    checar(iniciado.ok === true, `iniciou após validar a dispensa (${iniciado.message || iniciado.error})`);
    checar(/53\/2026/.test(textoConfirmacao) && /781402/.test(textoConfirmacao), "pediu confirmação mostrando número e UASG corretos");
    checar(/melhor valor menos o intervalo mínimo/i.test(textoConfirmacao), "explicou a regra antes de autorizar lances reais");
    checar(/R\$ 127,0000/.test(textoConfirmacao) && /R\$ 120,0000/.test(textoConfirmacao), "prévia usou melhor 128 − intervalo 1 e informou o piso");

    const limite = Date.now() + 8000;
    while (Date.now() < limite && lances.length === 0) await sleep(50);
    checar(JSON.stringify(lances) === JSON.stringify(["127,0000"]), `enviou uma vez o lance correto (${JSON.stringify(lances)})`);
    const estado = await enviar({ action: "disputa_status" });
    checar(estado.ativo === true, "continua monitorando após confirmar o lance");
    const painel = window.document.getElementById("__comprasnet_bot_painel__");
    checar(/Valor Mínimo/.test(painel?.textContent || ""), "o painel informa o limite rígido do Valor Mínimo");

    const parada = await enviar({ action: "disputa_stop" });
    checar(parada.stopped === true, "o comando Parar encerra o monitoramento");
    await sleep(1300);
    checar(lances.length === 1, "não repetiu o mesmo lance após a parada");
    window.close();
  }

  console.log("\n── 7) Modo Disputa: não envia quando o lance calculado cruza o Valor Mínimo ──");
  {
    const lances = [];
    const { window, enviar } = montarPagina(paginaDisputa(), {
      url: "https://www.gov.br/compras/fornecedor/enviar-lance",
      preparar: (w) => {
        w.confirm = () => true;
        w.document.getElementById("enviar-1").addEventListener("click", () => lances.push(w.document.getElementById("novo-1").value));
      },
    });
    window.__armazenamento.apiUrl = "https://app.exemplo.com";
    window.fetch = async (url) => {
      const destino = String(url);
      if (destino.endsWith("/api/propostas/7/script")) {
        return { ok: true, status: 200, json: async () => ({ proposta: { numeroDispensa: "53/2026", uasg: "781402" } }) };
      }
      if (destino.endsWith("/api/propostas/7/itens")) {
        return { ok: true, status: 200, json: async () => [{ numeroItem: 1, valorMinimo: "127.5000" }] };
      }
      if (destino.endsWith("/api/propostas")) {
        return { ok: true, status: 200, json: async () => [{ id: 7, numeroDispensa: "53/2026", uasg: "781402", totalItens: 1, itensPreenchidos: 1 }] };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const iniciado = await enviar({ action: "disputa_start", propostaId: "7" });
    checar(iniciado.ok === true, "permitiu monitorar com piso cadastrado");
    await sleep(600);
    checar(lances.length === 0, "não clicou Enviar lance quando 127,0000 ficaria abaixo do mínimo 127,5000");
    const status = await enviar({ action: "disputa_status" });
    checar(status.ativo === true, "continua monitorando sem enviar preço proibido");
    checar(status.itensNoPiso?.includes("1"), "encerra os lances automáticos do item antes de cruzar o piso");
    window.document.getElementById("melhor-1").textContent = "R$ 126,0000";
    await sleep(1500);
    checar(lances.length === 0, "não volta a lançar nesse item depois de ser travado pelo piso");
    await enviar({ action: "disputa_stop" });
    window.close();
  }

  console.log("\n── 8) Modo Disputa: ao confirmar lance no piso, encerra novos lances daquele item ──");
  {
    const lances = [];
    const { window, enviar } = montarPagina(paginaDisputa(), {
      url: "https://www.gov.br/compras/fornecedor/enviar-lance",
      preparar: (w) => {
        w.confirm = () => true;
        w.document.getElementById("enviar-1").addEventListener("click", () => {
          const valor = w.document.getElementById("novo-1").value;
          lances.push(valor);
          w.document.getElementById("meu-1").textContent = `R$ ${valor}`;
          w.document.getElementById("melhor-1").textContent = `R$ ${valor}`;
        });
      },
    });
    window.__armazenamento.apiUrl = "https://app.exemplo.com";
    window.fetch = async (url) => {
      const destino = String(url);
      if (destino.endsWith("/api/propostas/7/script")) {
        return { ok: true, status: 200, json: async () => ({ proposta: { numeroDispensa: "53/2026", uasg: "781402" } }) };
      }
      if (destino.endsWith("/api/propostas/7/itens")) {
        return { ok: true, status: 200, json: async () => [{ numeroItem: 1, valorMinimo: "127.0000" }] };
      }
      if (destino.endsWith("/api/propostas")) {
        return { ok: true, status: 200, json: async () => [{ id: 7, numeroDispensa: "53/2026", uasg: "781402", totalItens: 1, itensPreenchidos: 1 }] };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const iniciado = await enviar({ action: "disputa_start", propostaId: "7" });
    checar(iniciado.ok === true, "iniciou com piso de R$ 127,0000");
    const limite = Date.now() + 8000;
    while (Date.now() < limite && lances.length === 0) await sleep(50);
    checar(JSON.stringify(lances) === JSON.stringify(["127,0000"]), "enviou exatamente o lance final no piso");

    const prazoPiso = Date.now() + 3000;
    let status = await enviar({ action: "disputa_status" });
    while (Date.now() < prazoPiso && !status.itensNoPiso?.includes("1")) {
      await sleep(100);
      status = await enviar({ action: "disputa_status" });
    }
    checar(status.itensNoPiso?.includes("1"), "marca o item como encerrado depois da confirmação do piso");

    // Mesmo que o DOM ofereça depois outra oportunidade acima do piso, não reabre este item.
    window.document.getElementById("meu-1").textContent = "R$ 130,0000";
    window.document.getElementById("melhor-1").textContent = "R$ 128,5000";
    await sleep(1500);
    checar(lances.length === 1, "não enviou outro lance após atingir o Valor Mínimo");
    await enviar({ action: "disputa_stop" });
    window.close();
  }

  console.log("\n── 9) Modo Disputa: intervalo percentual usa o melhor valor atual ──");
  {
    const lances = [];
    let textoConfirmacao = "";
    const { window, enviar } = montarPagina(paginaDisputa({ melhor: "0,1700", meu: "0,2000", intervalo: "1,0000%" }), {
      url: "https://www.gov.br/compras/fornecedor/enviar-lance",
      preparar: (w) => {
        w.confirm = (texto) => { textoConfirmacao = texto; return true; };
        w.document.getElementById("enviar-1").addEventListener("click", () => {
          const valor = w.document.getElementById("novo-1").value;
          lances.push(valor);
          w.document.getElementById("meu-1").textContent = `R$ ${valor}`;
          w.document.getElementById("melhor-1").textContent = `R$ ${valor}`;
        });
      },
    });
    window.__armazenamento.apiUrl = "https://app.exemplo.com";
    window.fetch = async (url) => {
      const destino = String(url);
      if (destino.endsWith("/api/propostas/7/script")) {
        return { ok: true, status: 200, json: async () => ({ proposta: { numeroDispensa: "53/2026", uasg: "781402" } }) };
      }
      if (destino.endsWith("/api/propostas/7/itens")) {
        return { ok: true, status: 200, json: async () => [{ numeroItem: 1, valorMinimo: "0,1000" }] };
      }
      if (destino.endsWith("/api/propostas")) {
        return { ok: true, status: 200, json: async () => [{ id: 7, numeroDispensa: "53/2026", uasg: "781402", totalItens: 1, itensPreenchidos: 1 }] };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const iniciado = await enviar({ action: "disputa_start", propostaId: "7" });
    checar(iniciado.ok === true, `iniciou com intervalo percentual (${iniciado.message || iniciado.error})`);
    checar(/1,0000% \(R\$ 0,0017\)/.test(textoConfirmacao), "mostrou a conversão de 1% sobre R$ 0,1700");
    checar(/R\$ 0,1683/.test(textoConfirmacao), "calculou o lance respeitando 1% de diferença");
    const limite = Date.now() + 8000;
    while (Date.now() < limite && lances.length === 0) await sleep(50);
    checar(JSON.stringify(lances) === JSON.stringify(["0,1683"]), `enviou o lance percentual correto (${JSON.stringify(lances)})`);
    await enviar({ action: "disputa_stop" });
    window.close();
  }

  console.log("\n── 10) Modo Disputa: proposta/UASG divergente não inicia nem pede confirmação ──");
  {
    let pediuConfirmacao = false;
    const { window, enviar } = montarPagina(paginaDisputa(), {
      url: "https://www.gov.br/compras/fornecedor/enviar-lance",
      preparar: (w) => { w.confirm = () => { pediuConfirmacao = true; return true; }; },
    });
    window.__armazenamento.apiUrl = "https://app.exemplo.com";
    window.fetch = async (url) => {
      const destino = String(url);
      if (destino.endsWith("/api/propostas/7/script")) {
        return { ok: true, status: 200, json: async () => ({ proposta: { numeroDispensa: "53/2026", uasg: "999999" } }) };
      }
      if (destino.endsWith("/api/propostas/7/itens")) {
        return { ok: true, status: 200, json: async () => [{ numeroItem: 1, valorMinimo: "120.0000" }] };
      }
      return { ok: true, status: 200, json: async () => [] };
    };
    const resultado = await enviar({ action: "disputa_start", propostaId: "7" });
    checar(resultado.ok === false && /não corresponde/.test(resultado.error || ""), "recusou a proposta com UASG divergente");
    checar(pediuConfirmacao === false, "não mostrou confirmação se a identificação não bate");
    checar((await enviar({ action: "disputa_status" })).ativo === false, "não iniciou monitoramento para outra UASG");
    window.close();
  }

  return falhas;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const falhas = await rodarPainel();
  console.log(falhas ? `\n💥 ${falhas} falha(s)` : "\n🎉 Painel e pausa OK");
  process.exitCode = falhas ? 1 : 0;
}
