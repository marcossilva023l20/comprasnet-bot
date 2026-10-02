// Service Worker - handles messages between popup and content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "open_tab") {
    chrome.tabs.create({ url: msg.url }, (tab) => {
      sendResponse({ tabId: tab.id });
    });
    return true;
  }

  // Ponte de API: o content script roda na página do ComprasNet e não pode
  // fazer fetch para o sistema (CORS). Aqui, no contexto da extensão (que tem
  // permissão de host), a chamada funciona e o resultado volta pelo canal.
  if (msg.action === "api_request") {
    (async () => {
      try {
        const resposta = await fetch(msg.url, {
          method: msg.method || "GET",
          headers: msg.headers || undefined,
          body: msg.body || undefined,
        });

        const texto = await resposta.text();
        let dados = null;
        try {
          dados = texto ? JSON.parse(texto) : null;
        } catch (_) {
          dados = texto;
        }
        sendResponse({ ok: resposta.ok, status: resposta.status, dados });
      } catch (erro) {
        sendResponse({ ok: false, error: erro.message });
      }
    })();
    return true;
  }
});

// ─── Aviso de atualização disponível ─────────────────────────────────────────
// A extensão "sem compactação" não consegue se atualizar sozinha (limitação do
// Chrome). O que dá para fazer é conferir de tempos em tempos e marcar o ícone
// com "!" — o popup mostra o detalhe e a página atualizar.html faz o trabalho.
const INTERVALO_CHECAGEM_MS = 6 * 60 * 60 * 1000; // 6 horas

async function checarAtualizacao() {
  try {
    const { apiUrl, updateInfo } = await chrome.storage.local.get(["apiUrl", "updateInfo"]);
    if (!apiUrl) return;

    // Evita consultar na rede sem necessidade dentro da mesma janela de tempo.
    if (updateInfo?.em && Date.now() - updateInfo.em < INTERVALO_CHECAGEM_MS) {
      aplicarBadge(updateInfo.precisaAtualizar);
      return;
    }

    const instalada = chrome.runtime.getManifest().version;
    const res = await fetch(`${apiUrl}/api/extensao/versao?instalada=${encodeURIComponent(instalada)}`, { cache: "no-store" });
    if (!res.ok) return;

    const info = await res.json();
    await chrome.storage.local.set({ updateInfo: { ...info, em: Date.now() } });
    aplicarBadge(info.precisaAtualizar);
  } catch (_) {
    // sem rede / servidor fora do ar: tenta de novo na próxima
  }
}

function aplicarBadge(disponivel) {
  chrome.action.setBadgeText({ text: disponivel ? "!" : "" });
  if (disponivel) chrome.action.setBadgeBackgroundColor({ color: "#d97706" });
}

chrome.runtime.onStartup.addListener(checarAtualizacao);
chrome.runtime.onInstalled.addListener(checarAtualizacao);
