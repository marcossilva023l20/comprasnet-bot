import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  NOVIDADES_EXTENSAO,
  NOME_EXTENSAO,
  VERSAO_EXTENSAO,
  compararVersoes,
  montarEstadoAtualizacao,
  novidadesDesde,
  versaoValida,
} from "../src/lib/extensao";

const raiz = path.join(__dirname, "..");
const pacoteRecomendado = JSON.parse(
  readFileSync(path.join(raiz, "public", "extension-files.json"), "utf8"),
) as { versao: string; nome: string; arquivos: { caminho: string; texto?: string }[] };
const manifest = JSON.parse(pacoteRecomendado.arquivos.find((a) => a.caminho === "manifest.json")?.texto || "{}") as { version: string; name: string };
const manifestFonte = JSON.parse(readFileSync(path.join(raiz, "public", "extension", "manifest.json"), "utf8")) as { version: string; name: string };
const politica = JSON.parse(readFileSync(path.join(raiz, "config", "extension-policy.json"), "utf8")) as { recomendada: string };
const publicarFonteLocal = process.env.NODE_ENV !== "production" || !process.env.VERCEL;
const versoesPublicadas = NOVIDADES_EXTENSAO.filter((n) => compararVersoes(n.versao, VERSAO_EXTENSAO) <= 0);
const prefixoPacoteEsperado = publicarFonteLocal && VERSAO_EXTENSAO !== politica.recomendada
  ? `/extension-releases/${VERSAO_EXTENSAO}`
  : "";

test("a versão publicada respeita a política de produção e a fonte local", () => {
  assert.equal(VERSAO_EXTENSAO, publicarFonteLocal ? manifestFonte.version : politica.recomendada);
  assert.equal(NOME_EXTENSAO, manifestFonte.name);
  assert.equal(pacoteRecomendado.versao, politica.recomendada);
  assert.equal(manifest.version, pacoteRecomendado.versao);
  assert.ok(versaoValida(VERSAO_EXTENSAO), `versão inválida: ${VERSAO_EXTENSAO}`);
});

test("a versão mais recente da fonte tem novidades cadastradas", () => {
  const maisRecente = [...NOVIDADES_EXTENSAO].sort((a, b) => compararVersoes(b.versao, a.versao))[0];
  assert.equal(maisRecente.versao, manifestFonte.version);
  assert.ok(NOVIDADES_EXTENSAO.some((n) => n.versao === VERSAO_EXTENSAO));
  assert.ok(maisRecente.itens.length > 0);
  for (const novidade of NOVIDADES_EXTENSAO) {
    assert.ok(versaoValida(novidade.versao), `novidade com versão inválida: ${novidade.versao}`);
  }
});

test("compararVersoes ordena corretamente", () => {
  assert.equal(compararVersoes("1.4.0", "1.3.0"), 1);
  assert.equal(compararVersoes("1.3.0", "1.4.0"), -1);
  assert.equal(compararVersoes("1.4.0", "1.4.0"), 0);
  // partes ausentes valem zero
  assert.equal(compararVersoes("1.4", "1.4.0"), 0);
  assert.equal(compararVersoes("1.10.0", "1.9.9"), 1);
  // sufixos não numéricos são ignorados
  assert.equal(compararVersoes("1.4.0-beta", "1.4.0"), 0);
  // valores ausentes/inválidos contam como "muito antigos"
  assert.equal(compararVersoes("1.0.0", null), 1);
  assert.equal(compararVersoes(null, "1.0.0"), -1);
  assert.equal(compararVersoes(undefined, undefined), 0);
});

test("versaoValida aceita 1 a 4 partes numéricas", () => {
  assert.ok(versaoValida("1.4.0"));
  assert.ok(versaoValida("2"));
  assert.ok(versaoValida("1.4.0.0"));
  assert.ok(!versaoValida("1.4.0-beta"));
  assert.ok(!versaoValida("v1.4"));
  assert.ok(!versaoValida(""));
  assert.ok(!versaoValida(null));
  assert.ok(!versaoValida(1.4));
});

test("novidadesDesde mostra só o que é mais novo que a versão instalada", () => {
  // Compatível com novas versões: o esperado é calculado a partir do histórico.
  const esperado = (base: string) =>
    versoesPublicadas
      .filter((n) => compararVersoes(n.versao, base) > 0)
      .map((n) => n.versao)
      .sort((a, b) => compararVersoes(b, a));

  for (const base of ["1.2.0", "1.3.0", "1.4.0"]) {
    assert.deepEqual(novidadesDesde(base).map((n) => n.versao), esperado(base), `base ${base}`);
  }

  // quem já está na última versão não vê novidade nenhuma
  assert.equal(novidadesDesde(VERSAO_EXTENSAO).length, 0);

  // o histórico inclui as versões da leitura de itens e da atualização em 1 clique
  const todas = novidadesDesde("0.0.1").map((n) => n.versao);
  for (const versao of ["1.3.0", "1.4.0"]) assert.ok(todas.includes(versao), `histórico sem ${versao}`);

  // Sem versão instalada, mostra somente as novidades da versão publicada neste ambiente.
  assert.equal(novidadesDesde(null).length, versoesPublicadas.length);
  assert.equal(novidadesDesde("1.9.9").length, 0);
});

test("montarEstadoAtualizacao descreve a atualização da extensão", () => {
  const desatualizada = montarEstadoAtualizacao("1.3.0");
  assert.equal(desatualizada.versao, VERSAO_EXTENSAO);
  assert.equal(desatualizada.instalada, "1.3.0");
  assert.ok(desatualizada.precisaAtualizar);
  assert.ok(!desatualizada.adiantada);
  assert.ok(desatualizada.novidades.length > 0);
  assert.equal(desatualizada.zip.url, `${prefixoPacoteEsperado}/extension.zip`);
  assert.ok(desatualizada.zip.nome.startsWith("comprasnet-bot-extensao-"));
  assert.equal(desatualizada.arquivosUrl, `${prefixoPacoteEsperado}/extension-files.json`);

  const emDia = montarEstadoAtualizacao(VERSAO_EXTENSAO);
  assert.ok(!emDia.precisaAtualizar);
  assert.ok(!emDia.adiantada);
  assert.equal(emDia.novidades.length, 0);

  const adiantada = montarEstadoAtualizacao("9.9.9");
  assert.ok(!adiantada.precisaAtualizar);
  assert.ok(adiantada.adiantada);

  const semVersao = montarEstadoAtualizacao(null);
  assert.equal(semVersao.instalada, null);
  assert.ok(semVersao.precisaAtualizar);
  assert.equal(semVersao.novidades.length, versoesPublicadas.length);

  const invalida = montarEstadoAtualizacao("sei-la");
  assert.equal(invalida.instalada, null);
  assert.ok(invalida.precisaAtualizar);
});

test("o pacote de arquivos é gerado a partir do manifest e cobre todos os arquivos da extensão", () => {
  const pacote = JSON.parse(
    readFileSync(path.join(raiz, "public", "extension-files.json"), "utf8"),
  ) as { nome: string; versao: string; arquivos: { caminho: string; texto?: string; base64?: string }[] };

  assert.equal(pacote.versao, politica.recomendada);
  assert.equal(pacote.nome, manifest.name);

  const caminhos = pacote.arquivos.map((a) => a.caminho);
  for (const obrigatorio of ["manifest.json", "content.js", "background.js", "popup.html", "popup.js", "atualizar.html", "atualizar.js"]) {
    assert.ok(caminhos.includes(obrigatorio), `pacote sem ${obrigatorio}`);
  }
  // os ícones vão em base64, os demais arquivos em texto
  assert.ok(pacote.arquivos.find((a) => a.caminho === "icon128.png")?.base64);
  assert.ok(pacote.arquivos.find((a) => a.caminho === "manifest.json")?.texto);
  for (const arquivo of pacote.arquivos) {
    assert.ok(arquivo.texto !== undefined || arquivo.base64 !== undefined, `${arquivo.caminho} sem conteúdo`);
  }
});

test("o pacote reflete exatamente os arquivos publicados da extensão", () => {
  // O pacote padrão é a recomendada estável; o content script da fonte pode
  // ser uma versão BETA distinta, escolhível somente no catálogo.
  const pacote = JSON.parse(
    readFileSync(path.join(raiz, "public", "extension-files.json"), "utf8"),
  ) as { versao: string; arquivos: { caminho: string; texto?: string; base64?: string }[] };
  assert.equal(pacote.versao, politica.recomendada);
  const pastaPacote = path.join(raiz, "public", "extension-releases", pacote.versao);
  const fontes = readdirSync(path.join(raiz, "public", "extension")).sort();
  assert.deepEqual(pacote.arquivos.map((a) => a.caminho).sort(), fontes);
  const zip = new AdmZip(readFileSync(path.join(pastaPacote, "extension.zip")));
  for (const arquivo of pacote.arquivos) {
    const noPacote = arquivo.texto !== undefined ? Buffer.from(arquivo.texto, "utf8") : Buffer.from(arquivo.base64 as string, "base64");
    const noZip = zip.readFile(`comprasnet-bot/${arquivo.caminho}`);
    assert.ok(noZip?.equals(noPacote), `conteúdo de ${arquivo.caminho} difere do pacote ZIP recomendado`);
  }
});


for (const instalada of ["1.8.1", "1.8.2", "1.8.3", "1.8.4", "1.8.5", "1.8.6", "1.8.7"]) {
  test(`o estado da instalação ${instalada} respeita a versão publicada sem downgrade implícito`, () => {
    const estado = montarEstadoAtualizacao(instalada);
    const comparacao = compararVersoes(VERSAO_EXTENSAO, instalada);
    assert.equal(estado.versao, VERSAO_EXTENSAO);
    assert.equal(estado.precisaAtualizar, comparacao > 0);
    assert.equal(estado.adiantada, comparacao < 0);
    assert.equal(estado.zip.nome, `comprasnet-bot-extensao-${VERSAO_EXTENSAO}.zip`);
    assert.equal(estado.zip.url, `${prefixoPacoteEsperado}/extension.zip`);
    assert.equal(estado.novidades.length, versoesPublicadas.filter((n) => compararVersoes(n.versao, instalada) > 0).length);
  });
}

test("o popup carrega seu script somente uma vez", () => {
  const html = readFileSync(path.join(raiz, "public", "extension", "popup.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']popup\.js["'][^>]*>/gi)];
  assert.equal(scripts.length, 1, "o script duplicado impede a inicialização correta do popup");
  assert.equal((html.match(/<\/body\s*>/gi) || []).length, 1);
  assert.equal((html.match(/<\/html\s*>/gi) || []).length, 1);
});
