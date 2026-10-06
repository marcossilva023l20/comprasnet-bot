/** Instala a versão escolhida somente após confirmação, com validação e cópia de segurança. */
const IDB_NOME = "comprasnet-bot-updater";
const IDB_STORE = "handles";
const CHAVE_HANDLE = "pasta-extensao";
const NOME_EXTENSAO = "ComprasNet - Preenchedor de Propostas";
const ARQUIVOS_ESPERADOS = ["atualizar.html", "atualizar.js", "background.js", "content.js", "icon128.png", "icon16.png", "icon48.png", "manifest.json", "popup.html", "popup.js"];
const el = {
  status: document.getElementById("status"), versaoInstalada: document.getElementById("versao-instalada"),
  versaoPublicada: document.getElementById("versao-publicada"), pastaAtual: document.getElementById("pasta-atual"),
  btnConectar: document.getElementById("btn-conectar"), btnAtualizar: document.getElementById("btn-atualizar"),
  btnBaixar: document.getElementById("btn-baixar"), btnRecarregar: document.getElementById("btn-recarregar"),
  seletor: document.getElementById("versao-selecionada"), detalhes: document.getElementById("versao-detalhes"),
  alerta: document.getElementById("versao-alerta"), log: document.getElementById("log"),
};
let apiUrl = "", pasta = null, pacote = null, catalogo = null, selecionada = null;
let ocupado = false, carregando = false, requisicao = 0, controller = null;
const instalada = chrome.runtime.getManifest().version;
const versaoValida = (v) => typeof v === "string" && /^\d{1,4}(?:\.\d{1,4}){1,3}$/.test(v);
const escapar = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function comparar(a, b) {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
  return 0;
}
function mostrarStatus(tipo, html) { el.status.className = `status status-${tipo} show`; el.status.innerHTML = html; }
function registrar(m) { el.log.classList.add("show"); el.log.textContent += `${m}\n`; el.log.scrollTop = el.log.scrollHeight; }
function habilitarBotoes() {
  el.btnAtualizar.disabled = ocupado || carregando || !(pasta && pacote && selecionada && pacote.versao === selecionada.versao && pacote.versao !== instalada);
  el.btnConectar.disabled = ocupado;
  el.btnRecarregar.disabled = ocupado || carregando;
  el.seletor.disabled = ocupado || !catalogo;
  el.btnBaixar.style.display = selecionada ? "flex" : "none";
  el.btnBaixar.disabled = ocupado;
}
function urlDoPacote(entrada, zip = false) {
  const caminho = zip ? entrada.zip.url : entrada.arquivosUrl;
  const esperado = `/extension-releases/${entrada.versao}/${zip ? "extension.zip" : "extension-files.json"}`;
  if (caminho !== esperado) throw new Error("Endereço da versão não corresponde ao catálogo.");
  return new URL(caminho, apiUrl).toString();
}
function validarCatalogo(dados) {
  if (!versaoValida(dados?.recomendada) || !Array.isArray(dados.versoes) || !dados.versoes.length || dados.versoes.length > 60) throw new Error("Catálogo de versões inválido.");
  const vistos = new Set();
  for (const v of dados.versoes) {
    if (!versaoValida(v.versao) || vistos.has(v.versao) || typeof v.descricao !== "string" || typeof v.experimental !== "boolean" || !/^[a-f0-9]{64}$/.test(v.sha256) || !v.zip || v.zip.nome !== `comprasnet-bot-extensao-${v.versao}.zip`) throw new Error("Entrada inválida no catálogo.");
    vistos.add(v.versao); urlDoPacote(v); urlDoPacote(v, true);
  }
  const recomendada = dados.versoes.find((v) => v.versao === dados.recomendada);
  if (!recomendada || recomendada.experimental) throw new Error("A recomendada não pode ser experimental.");
  return dados;
}
async function digest(bytes) {
  const valor = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(valor)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function conteudoDoArquivo(entrada) {
  if (typeof entrada.texto === "string") return new TextEncoder().encode(entrada.texto);
  if (typeof entrada.base64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entrada.base64)) throw new Error("Arquivo binário inválido.");
  return Uint8Array.from(atob(entrada.base64), (c) => c.charCodeAt(0));
}
function validarPacote(dados, versao) {
  if (dados?.nome !== NOME_EXTENSAO || dados.versao !== versao || !Array.isArray(dados.arquivos) || dados.arquivos.length !== ARQUIVOS_ESPERADOS.length) throw new Error("O pacote não corresponde à versão escolhida.");
  const nomes = new Set();
  for (const a of dados.arquivos) {
    if (!ARQUIVOS_ESPERADOS.includes(a.caminho) || nomes.has(a.caminho) || (typeof a.texto === "string") === (typeof a.base64 === "string")) throw new Error("Arquivos duplicados, ausentes ou caminhos inseguros no pacote.");
    const bytes = conteudoDoArquivo(a);
    if (!Number.isSafeInteger(a.bytes) || a.bytes !== bytes.length || bytes.length > 3 * 1024 * 1024) throw new Error("Tamanho do arquivo não confere.");
    nomes.add(a.caminho);
  }
  const manifest = JSON.parse(dados.arquivos.find((a) => a.caminho === "manifest.json").texto);
  if (manifest.name !== NOME_EXTENSAO || manifest.version !== versao || manifest.manifest_version !== 3) throw new Error("Manifesto não corresponde à versão escolhida.");
  return dados;
}
async function selecionarVersao() {
  if (ocupado) return;
  const id = ++requisicao;
  controller?.abort(); controller = new AbortController();
  const signal = controller.signal;
  selecionada = catalogo.versoes.find((v) => v.versao === el.seletor.value) || null;
  const entrada = selecionada;
  pacote = null; carregando = true;
  el.detalhes.textContent = entrada ? `Versão ${entrada.versao}: ${entrada.descricao}` : "Versão indisponível.";
  const mensagens = [];
  if (entrada && comparar(entrada.versao, instalada) < 0) mensagens.push(`Você está voltando da ${instalada} para a ${entrada.versao}; recursos posteriores deixarão de existir.`);
  if (entrada?.experimental) mensagens.push("EXPERIMENTAL: esta versão pode enviar lances reais. A operação no portal não foi validada; instale apenas se compreender o risco.");
  el.alerta.textContent = mensagens.join(" "); el.alerta.hidden = !mensagens.length;
  habilitarBotoes();
  try {
    if (!entrada) throw new Error("Escolha uma versão disponível.");
    mostrarStatus("info", `Conferindo o pacote ${escapar(entrada.versao)}; nenhum arquivo será gravado nesta etapa.`);
    const resp = await fetch(urlDoPacote(entrada), { cache: "no-store", signal });
    if (!resp.ok) throw new Error(`Pacote indisponível (HTTP ${resp.status}).`);
    const texto = await resp.text();
    if (texto.length > 8 * 1024 * 1024 || await digest(new TextEncoder().encode(texto)) !== entrada.sha256) throw new Error("A integridade do pacote não confere. Recarregue o catálogo.");
    const novo = validarPacote(JSON.parse(texto), entrada.versao);
    if (id !== requisicao || signal.aborted) return;
    pacote = novo;
    registrar(`Pacote ${entrada.versao} conferido: ${novo.arquivos.length} arquivos, SHA-256 válido.`);
    mostrarStatus(entrada.versao === instalada ? "ok" : "info", entrada.versao === instalada ? `Você já está na ${escapar(instalada)}.` : `Versão ${escapar(entrada.versao)} pronta. Conecte a pasta e confirme a instalação quando quiser.`);
  } catch (e) {
    if (id !== requisicao || e?.name === "AbortError") return;
    pacote = null;
    mostrarStatus("error", `Não consegui preparar essa versão: ${escapar(e?.message || e)} Nenhum arquivo foi gravado.`);
  } finally {
    if (id === requisicao) { carregando = false; habilitarBotoes(); }
  }
}
async function carregarCatalogo() {
  if (ocupado) return;
  ++requisicao; controller?.abort(); pacote = null; selecionada = null; catalogo = null; carregando = true;
  habilitarBotoes();
  try {
    if (!apiUrl) throw new Error("Configure a URL do sistema na aba Config do popup.");
    const resposta = await fetch(new URL("/extension-versions.json", apiUrl), { cache: "no-store" });
    if (!resposta.ok) throw new Error(`Catálogo indisponível (HTTP ${resposta.status}).`);
    catalogo = validarCatalogo(await resposta.json());
    el.versaoPublicada.textContent = catalogo.recomendada;
    el.seletor.replaceChildren();
    for (const v of catalogo.versoes) {
      const option = document.createElement("option"); option.value = v.versao;
      option.textContent = `${v.versao}${v.versao === catalogo.recomendada ? " — recomendada/estável" : ""}${v.experimental ? " — EXPERIMENTAL" : ""}`;
      el.seletor.append(option);
    }
    // Ao voltar ao atualizador, mantenha a versão instalada selecionada para
    // não apresentar um downgrade como ação padrão. Instalações antigas/ausentes
    // recebem a versão estável recomendada.
    el.seletor.value = catalogo.versoes.some((v) => v.versao === instalada) ? instalada : catalogo.recomendada;
    await selecionarVersao();
  } catch (e) {
    catalogo = null; carregando = false;
    mostrarStatus("error", `Não consegui carregar as versões: ${escapar(e?.message || e)}.`);
    habilitarBotoes();
  }
}
function abrirBanco() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NOME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
async function salvarPasta(handle) {
  const db = await abrirBanco();
  await new Promise((resolve, reject) => { const tx = db.transaction(IDB_STORE, "readwrite"); tx.objectStore(IDB_STORE).put(handle, CHAVE_HANDLE); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  db.close();
}
async function lerPasta() {
  try {
    const db = await abrirBanco();
    const handle = await new Promise((resolve, reject) => { const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(CHAVE_HANDLE); req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error); });
    db.close(); return handle;
  } catch { return null; }
}
async function lerManifestDaPasta(handle) { const arquivo = await handle.getFileHandle("manifest.json"); return JSON.parse(await (await arquivo.getFile()).text()); }
async function conectarPasta() {
  if (ocupado) return;
  if (typeof window.showDirectoryPicker !== "function") { mostrarStatus("error", "Seu navegador não oferece o seletor de pastas. Baixe o ZIP da versão selecionada e recarregue em chrome://extensions."); return; }
  try {
    const handle = await window.showDirectoryPicker({ id: "comprasnet-bot-extensao", mode: "readwrite", startIn: "downloads" });
    const manifest = await lerManifestDaPasta(handle);
    if (manifest?.name !== NOME_EXTENSAO || !versaoValida(manifest.version)) throw new Error("Escolha a pasta do ComprasNet Bot que contém manifest.json.");
    pasta = handle;
    try { await salvarPasta(handle); } catch { registrar("Pasta conectada para esta sessão; não consegui guardar a preferência."); }
    el.pastaAtual.textContent = `Pasta conectada: ${handle.name} (versão ${manifest.version})`;
    mostrarStatus("ok", "Pasta conectada. A instalação ainda depende da sua confirmação.");
  } catch (e) { if (e?.name !== "AbortError") mostrarStatus("error", `Não consegui conectar: ${escapar(e?.message || e)}.`); }
  habilitarBotoes();
}
async function garantirPermissao(handle) { const o = { mode: "readwrite" }; return await handle.queryPermission?.(o) === "granted" || await handle.requestPermission?.(o) === "granted"; }
async function gravarArquivo(handle, nome, bytes) {
  if (!ARQUIVOS_ESPERADOS.includes(nome)) throw new Error("Caminho não permitido.");
  const arquivo = await handle.getFileHandle(nome, { create: true });
  const escritor = await arquivo.createWritable();
  try { await escritor.write(bytes); await escritor.close(); }
  catch (e) { try { await escritor.abort?.(); } catch { /* Sem reload após falha. */ } throw e; }
}
async function instalar() {
  if (ocupado || carregando || !pasta || !pacote || !selecionada) return;
  const entrada = selecionada, dados = validarPacote(pacote, entrada.versao), destino = pasta;
  const retorno = comparar(entrada.versao, instalada) < 0;
  const aviso = `${retorno ? "Voltar" : "Instalar"} da versão ${instalada} para ${entrada.versao}?\n${entrada.experimental ? "ATENÇÃO: versão experimental, com lances reais não validados.\n" : ""}Pare os bots antes de continuar. Os arquivos da extensão serão substituídos; os dados do sistema não serão alterados.\n\nConfirmar instalação?`;
  if (!window.confirm(aviso)) return;
  ocupado = true; habilitarBotoes();
  const backup = new Map(), tocados = [];
  let concluido = false;
  try {
    if (!(await garantirPermissao(destino))) throw new Error("Permissão de escrita negada; reconecte a pasta.");
    const original = await lerManifestDaPasta(destino);
    if (original.name !== NOME_EXTENSAO) throw new Error("A pasta conectada mudou ou pertence a outra extensão.");
    if (original.version !== instalada && !window.confirm(`A pasta conectada tem ${original.version}, mas esta aba executa ${instalada}. Instalar ${entrada.versao} nesta pasta mesmo assim?`)) return;
    for (const a of dados.arquivos) {
      try { backup.set(a.caminho, new Uint8Array(await (await (await destino.getFileHandle(a.caminho)).getFile()).arrayBuffer())); }
      catch (e) { if (e?.name === "NotFoundError") backup.set(a.caminho, null); else throw e; }
    }
    mostrarStatus("info", `Instalando ${escapar(entrada.versao)}. Não feche esta aba até concluir.`);
    const ordenados = dados.arquivos.filter((a) => a.caminho !== "manifest.json").concat(dados.arquivos.filter((a) => a.caminho === "manifest.json"));
    for (const a of ordenados) { tocados.push(a.caminho); await gravarArquivo(destino, a.caminho, conteudoDoArquivo(a)); registrar(`Gravado: ${a.caminho}`); }
    const gravado = await lerManifestDaPasta(destino);
    if (gravado.version !== entrada.versao || gravado.name !== NOME_EXTENSAO) throw new Error("A conferência da versão gravada falhou.");
    mostrarStatus("ok", `Versão ${escapar(entrada.versao)} instalada. Recarregando a extensão… Feche esta aba, confirme a versão no popup e dê F5 no portal.`);
    concluido = true;
    setTimeout(() => chrome.runtime.reload(), 2200);
  } catch (e) {
    const falhas = [];
    for (const nome of [...tocados].reverse()) {
      try { const bytes = backup.get(nome); if (bytes === null) await destino.removeEntry(nome); else if (bytes) await gravarArquivo(destino, nome, bytes); }
      catch { falhas.push(nome); }
    }
    mostrarStatus("error", `Instalação não concluída: ${escapar(e?.message || e)}. ${falhas.length ? "Não consegui restaurar todos os arquivos. NÃO use o bot; extraia o ZIP escolhido sobre a pasta e recarregue manualmente." : tocados.length ? "A cópia anterior foi restaurada; a extensão não foi recarregada." : "Nenhum arquivo foi gravado."}`);
    registrar(`Falha na instalação${falhas.length ? `; restauração pendente: ${falhas.join(", ")}` : ""}.`);
  } finally { if (!concluido) ocupado = false; habilitarBotoes(); }
}
document.addEventListener("DOMContentLoaded", async () => {
  el.versaoInstalada.textContent = instalada;
  el.btnConectar.addEventListener("click", conectarPasta);
  el.btnRecarregar.addEventListener("click", carregarCatalogo);
  el.seletor.addEventListener("change", selecionarVersao);
  el.btnAtualizar.addEventListener("click", () => instalar().catch((e) => mostrarStatus("error", escapar(e.message))));
  el.btnBaixar.addEventListener("click", () => { if (selecionada && !ocupado) chrome.tabs.create({ url: urlDoPacote(selecionada, true) }); });
  const cfg = await chrome.storage.local.get(["apiUrl"]); apiUrl = cfg.apiUrl || "";
  pasta = await lerPasta();
  if (pasta) el.pastaAtual.textContent = `Pasta conectada: ${pasta.name} (a permissão será conferida antes de instalar)`;
  await carregarCatalogo();
});
