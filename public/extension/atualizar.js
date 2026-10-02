/**
 * Atualização da extensão em um clique.
 *
 * Como funciona: o Chrome não deixa uma extensão instalada "sem compactação"
 * se atualizar sozinha (isso só existe na Chrome Web Store ou por política
 * empresarial). O que dá para fazer — e é o que esta página faz — é gravar os
 * arquivos da versão publicada na própria pasta da extensão, com a permissão
 * que o usuário concede UMA vez pelo seletor de pastas, e recarregar.
 *
 * Esta página precisa rodar em uma aba normal da extensão: o seletor de pastas
 * não funciona dentro do popup (ele fecha quando o seletor abre).
 */

const IDB_NOME = "comprasnet-bot-updater";
const IDB_STORE = "handles";
const CHAVE_HANDLE = "pasta-extensao";

const el = {
  status: document.getElementById("status"),
  versaoInstalada: document.getElementById("versao-instalada"),
  versaoPublicada: document.getElementById("versao-publicada"),
  pastaAtual: document.getElementById("pasta-atual"),
  btnConectar: document.getElementById("btn-conectar"),
  btnAtualizar: document.getElementById("btn-atualizar"),
  btnBaixar: document.getElementById("btn-baixar"),
  log: document.getElementById("log"),
};

let apiUrl = "";
let pasta = null;
let pacote = null;

// ─── Utilidades de interface ─────────────────────────────────────────────────

function mostrarStatus(tipo, html) {
  el.status.className = `status status-${tipo} show`;
  el.status.innerHTML = html;
}

function registrar(mensagem) {
  el.log.classList.add("show");
  el.log.textContent += `${mensagem}\n`;
  el.log.scrollTop = el.log.scrollHeight;
}

function habilitarBotoes() {
  el.btnAtualizar.disabled = !(pasta && pacote && pacote.versao !== chrome.runtime.getManifest().version);
  el.btnBaixar.style.display = apiUrl ? "flex" : "none";
}

// ─── Índice de pastas (IndexedDB) ────────────────────────────────────────────

function abrirBanco() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NOME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function salvarPasta(handle) {
  const db = await abrirBanco();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(handle, CHAVE_HANDLE);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function lerPasta() {
  try {
    const db = await abrirBanco();
    const handle = await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(CHAVE_HANDLE);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return handle;
  } catch (_) {
    return null;
  }
}

// ─── Leitura/escrita de arquivos ─────────────────────────────────────────────

async function lerManifestDaPasta(handle) {
  const arquivo = await handle.getFileHandle("manifest.json");
  return JSON.parse(await (await arquivo.getFile()).text());
}

async function gravarArquivo(handle, caminho, conteudo) {
  const partes = caminho.split("/").filter(Boolean);
  let pastaAtual = handle;
  for (const parte of partes.slice(0, -1)) {
    pastaAtual = await pastaAtual.getDirectoryHandle(parte, { create: true });
  }

  const arquivo = await pastaAtual.getFileHandle(partes[partes.length - 1], { create: true });
  const escritor = await arquivo.createWritable();
  await escritor.write(conteudo);
  await escritor.close();
}

function conteudoDoArquivo(entrada) {
  if (typeof entrada.texto === "string") return entrada.texto;
  const binario = atob(entrada.base64 || "");
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

// ─── Fluxo ───────────────────────────────────────────────────────────────────

async function conectarPasta() {
  if (typeof window.showDirectoryPicker !== "function") {
    mostrarStatus(
      "error",
      "Este navegador não oferece o seletor de pastas. Use o botão <strong>⬇️ Baixar ZIP</strong> e extraia sobre a pasta da extensão (passo a passo no fim da página).",
    );
    el.btnBaixar.style.display = "flex";
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({ id: "comprasnet-bot-extensao", mode: "readwrite", startIn: "downloads" });

    let manifest;
    try {
      manifest = await lerManifestDaPasta(handle);
    } catch (_) {
      mostrarStatus(
        "error",
        "A pasta escolhida não parece ser a da extensão (não encontrei o <code>manifest.json</code>). Escolha a pasta que você carregou em <code>chrome://extensions</code>.",
      );
      return;
    }
    if (manifest?.name !== "ComprasNet - Preenchedor de Propostas") {
      mostrarStatus("error", `A pasta escolhida é de outra extensão (<strong>${manifest?.name || "sem nome"}</strong>). Escolha a pasta do ComprasNet Bot.`);
      return;
    }

    pasta = handle;
    await salvarPasta(handle);
    el.pastaAtual.textContent = `📂 Pasta conectada: ${handle.name} (versão ${manifest.version})`;
    registrar(`Pasta conectada: ${handle.name} (manifest ${manifest.version})`);
    mostrarStatus("ok", "Pasta conectada! Agora use o <strong>⚡ Atualizar agora</strong> sempre que quiser atualizar.");
    habilitarBotoes();
  } catch (erro) {
    if (erro?.name === "AbortError") return; // usuário cancelou o seletor
    mostrarStatus("error", `Não consegui conectar a pasta: ${erro?.message || erro}`);
  }
}

async function garantirPermissao(handle) {
  const opcoes = { mode: "readwrite" };
  if ((await handle.queryPermission?.(opcoes)) === "granted") return true;
  const resultado = await handle.requestPermission?.(opcoes);
  return resultado === "granted";
}

async function carregarPacote() {
  if (!apiUrl) throw new Error("Configure a URL do sistema na aba ⚙️ do popup.");
  const resposta = await fetch(new URL("/extension-files.json", apiUrl), { cache: "no-store" });
  if (!resposta.ok) throw new Error(`o servidor respondeu HTTP ${resposta.status}`);
  const dados = await resposta.json();
  if (!dados?.versao || !Array.isArray(dados?.arquivos)) throw new Error("o arquivo de atualização veio em formato inesperado");
  return dados;
}

async function atualizar(tentativa = 1) {
  const versaoAtual = chrome.runtime.getManifest().version;

  if (!(await garantirPermissao(pasta))) {
    mostrarStatus("error", "A permissão de escrita na pasta foi negada. Clique em <strong>📂 Conectar pasta da extensão</strong> novamente e aceite a permissão.");
    return;
  }

  mostrarStatus("info", `Gravando a versão <strong>${pacote.versao}</strong> na pasta <strong>${pasta.name}</strong>...`);

  const falhas = [];
  // O manifest.json vai por último: se algo falhar no meio, a versão instalada
  // continua sendo a antiga (sem misturar código novo com manifesto velho).
  const ordenados = [...pacote.arquivos].sort((a, b) => (a.caminho === "manifest.json" ? 1 : b.caminho === "manifest.json" ? -1 : 0));

  for (const entrada of ordenados) {
    try {
      await gravarArquivo(pasta, entrada.caminho, conteudoDoArquivo(entrada));
      registrar(`✓ ${entrada.caminho} (${entrada.bytes} bytes)`);
    } catch (erro) {
      registrar(`✗ ${entrada.caminho}: ${erro?.message || erro}`);
      falhas.push(entrada.caminho);
    }
  }

  if (falhas.length > 0) {
    if (tentativa < 2) {
      registrar("Tentando novamente...");
      await new Promise((r) => setTimeout(r, 600));
      return atualizar(tentativa + 1);
    }
    mostrarStatus(
      "error",
      `Não consegui gravar ${falhas.length} arquivo(s): <code>${falhas.join(", ")}</code>.<br>Use o <strong>⬇️ Baixar ZIP</strong> e extraia sobre a pasta da extensão.`,
    );
    el.btnBaixar.style.display = "flex";
    return;
  }

  // Confere o que ficou gravado antes de recarregar.
  const manifestGravado = await lerManifestDaPasta(pasta);
  if (manifestGravado.version !== pacote.versao) {
    mostrarStatus("error", `Gravei os arquivos, mas a versão do manifesto na pasta é ${manifestGravado.version} (esperava ${pacote.versao}). Confira se escolheu a pasta certa.`);
    return;
  }

  mostrarStatus(
    "ok",
    `✅ Versão <strong>${pacote.versao}</strong> gravada na pasta (antes: ${versaoAtual}).<br><br>
     Recarregando a extensão... <strong>esta aba pode ficar em branco agora — é normal</strong>.
     Feche-a e clique no ícone 🤖: o popup deve mostrar a versão ${pacote.versao}.`,
  );
  registrar(`Versão ${pacote.versao} instalada na pasta. Recarregando...`);
  setTimeout(() => chrome.runtime.reload(), 2200);
}

// ─── Inicialização ───────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  const cfg = await chrome.storage.local.get(["apiUrl"]);
  apiUrl = cfg.apiUrl || "";

  el.versaoInstalada.textContent = chrome.runtime.getManifest().version;

  el.btnConectar.addEventListener("click", conectarPasta);
  el.btnBaixar.addEventListener("click", () => chrome.tabs.create({ url: new URL("/extension.zip", apiUrl).toString() }));
  el.btnAtualizar.addEventListener("click", () => {
    if (!pasta || !pacote) return;
    el.btnAtualizar.disabled = true;
    atualizar().finally(() => habilitarBotoes());
  });

  pasta = await lerPasta();
  if (pasta) {
    const permitido = (await pasta.queryPermission?.({ mode: "readwrite" })) === "granted";
    el.pastaAtual.textContent = `📂 Pasta conectada: ${pasta.name}${permitido ? "" : " (a permissão será pedida ao atualizar)"}`;
    registrar(`Pasta já conectada: ${pasta.name}`);
  }

  try {
    pacote = await carregarPacote();
    el.versaoPublicada.textContent = pacote.versao;
    registrar(`Versão publicada: ${pacote.versao} (${pacote.arquivos.length} arquivos)`);

    if (pacote.versao === chrome.runtime.getManifest().version) {
      mostrarStatus("ok", `Você já está na versão mais recente (<strong>${pacote.versao}</strong>).`);
    } else if (!pasta) {
      mostrarStatus("info", `Nova versão disponível: <strong>${pacote.versao}</strong>. Conecte a pasta da extensão no passo 1 para atualizar em um clique.`);
    } else {
      mostrarStatus("info", `Nova versão disponível: <strong>${pacote.versao}</strong>. Clique em <strong>⚡ Atualizar agora</strong>.`);
    }
  } catch (erro) {
    mostrarStatus("warn", `Não consegui consultar a versão publicada (${erro.message}). Você pode baixar o ZIP manualmente.`);
  }

  habilitarBotoes();
});
