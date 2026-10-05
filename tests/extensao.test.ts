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
const manifest = JSON.parse(
  readFileSync(path.join(raiz, "public", "extension", "manifest.json"), "utf8"),
) as { version: string; name: string };

test("a versão do app bate com a do manifest da extensão", () => {
  assert.equal(VERSAO_EXTENSAO, manifest.version);
  assert.equal(NOME_EXTENSAO, manifest.name);
  assert.ok(versaoValida(VERSAO_EXTENSAO), `versão inválida: ${VERSAO_EXTENSAO}`);
});

test("a versão mais recente tem novidades cadastradas", () => {
  const maisRecente = [...NOVIDADES_EXTENSAO].sort((a, b) => compararVersoes(b.versao, a.versao))[0];
  assert.equal(maisRecente.versao, VERSAO_EXTENSAO);
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
    NOVIDADES_EXTENSAO.filter((n) => compararVersoes(n.versao, base) > 0)
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

  // sem versão instalada, mostra tudo (a extensão decide o que fazer)
  assert.equal(novidadesDesde(null).length, NOVIDADES_EXTENSAO.length);
  assert.equal(novidadesDesde("1.9.9").length, 0);
});

test("montarEstadoAtualizacao descreve a atualização da extensão", () => {
  const desatualizada = montarEstadoAtualizacao("1.3.0");
  assert.equal(desatualizada.versao, VERSAO_EXTENSAO);
  assert.equal(desatualizada.instalada, "1.3.0");
  assert.ok(desatualizada.precisaAtualizar);
  assert.ok(!desatualizada.adiantada);
  assert.ok(desatualizada.novidades.length > 0);
  assert.equal(desatualizada.zip.url, "/extension.zip");
  assert.ok(desatualizada.zip.nome.startsWith("comprasnet-bot-extensao-"));
  assert.equal(desatualizada.arquivosUrl, "/extension-files.json");

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
  assert.equal(semVersao.novidades.length, NOVIDADES_EXTENSAO.length);

  const invalida = montarEstadoAtualizacao("sei-la");
  assert.equal(invalida.instalada, null);
  assert.ok(invalida.precisaAtualizar);
});

test("o pacote de arquivos é gerado a partir do manifest e cobre todos os arquivos da extensão", () => {
  const pacote = JSON.parse(
    readFileSync(path.join(raiz, "public", "extension-files.json"), "utf8"),
  ) as { nome: string; versao: string; arquivos: { caminho: string; texto?: string; base64?: string }[] };

  assert.equal(pacote.versao, VERSAO_EXTENSAO);
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
  // `pretest` roda scripts/build-extension.mjs, então este arquivo existe sempre
  // que a suíte roda — e aqui garantimos que ele não ficou desatualizado.
  const pacote = JSON.parse(
    readFileSync(path.join(raiz, "public", "extension-files.json"), "utf8"),
  ) as { arquivos: { caminho: string; texto?: string; base64?: string }[] };

  const publicados = readdirSync(path.join(raiz, "public", "extension")).sort();
  assert.deepEqual(pacote.arquivos.map((a) => a.caminho).sort(), publicados);

  for (const arquivo of pacote.arquivos) {
    const real = readFileSync(path.join(raiz, "public", "extension", arquivo.caminho));
    const noPacote = arquivo.texto !== undefined ? Buffer.from(arquivo.texto, "utf8") : Buffer.from(arquivo.base64 as string, "base64");
    assert.ok(real.equals(noPacote), `conteúdo de ${arquivo.caminho} difere do publicado`);
  }
});


for (const instalada of ["1.7.19", "1.8.1", "1.8.2", "1.8.3", "1.8.4"]) {
  test(`a instalação ${instalada} recebe a atualização com a mesma versão do pacote`, () => {
    const estado = montarEstadoAtualizacao(instalada);
    assert.ok(estado.precisaAtualizar);
    assert.ok(!estado.adiantada);
    assert.equal(estado.versao, manifest.version);
    assert.equal(estado.zip.nome, `comprasnet-bot-extensao-${manifest.version}.zip`);
    assert.ok(estado.novidades.some((novidade) => novidade.versao === manifest.version));
  });
}

test("o popup carrega seu script somente uma vez", () => {
  const html = readFileSync(path.join(raiz, "public", "extension", "popup.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']popup\.js["'][^>]*>/gi)];
  assert.equal(scripts.length, 1, "o script duplicado impede a inicialização correta do popup");
  assert.equal((html.match(/<\/body\s*>/gi) || []).length, 1);
  assert.equal((html.match(/<\/html\s*>/gi) || []).length, 1);
});
