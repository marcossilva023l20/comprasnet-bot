import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import AdmZip from "adm-zip";

const root = new URL("../", import.meta.url);
const catalogo = JSON.parse(readFileSync(new URL("public/extension-versions.json", root), "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("o catálogo tem somente versões completas, únicas, com hashes e downloads correspondentes", () => {
  assert.equal(catalogo.recomendada, "1.7.20");
  assert.equal(catalogo.versoes[0].versao, catalogo.recomendada);
  assert.equal(catalogo.versoes[0].experimental, false);
  assert.equal(new Set(catalogo.versoes.map((v) => v.versao)).size, catalogo.versoes.length);
  for (const versao of catalogo.versoes) {
    const bytes = readFileSync(new URL(`public${versao.arquivosUrl}`, root));
    const zipBytes = readFileSync(new URL(`public${versao.zip.url}`, root));
    assert.equal(hash(bytes), versao.sha256);
    assert.equal(hash(zipBytes), versao.zipSha256);
    const pacote = JSON.parse(bytes.toString("utf8"));
    assert.equal(pacote.versao, versao.versao);
    assert.equal(pacote.arquivos.length, versao.arquivos);
    const zip = new AdmZip(zipBytes);
    for (const arquivo of pacote.arquivos) {
      const esperado = arquivo.texto !== undefined ? Buffer.from(arquivo.texto, "utf8") : Buffer.from(arquivo.base64, "base64");
      assert.deepEqual(zip.readFile(`comprasnet-bot/${arquivo.caminho}`), esperado, `${versao.versao}/${arquivo.caminho}`);
      if (versao.ref) {
        assert.deepEqual(execFileSync("git", ["show", `${versao.ref}:public/extension/${arquivo.caminho}`]), esperado);
      }
    }
    assert.equal(JSON.parse(pacote.arquivos.find((a) => a.caminho === "manifest.json").texto).version, versao.versao);
  }
});

test("versões com automação de lances ficam explicitamente experimentais e nunca são a recomendada", () => {
  const antigas = catalogo.versoes.filter((v) => /^1\.8\./.test(v.versao));
  assert.equal(antigas.length, 6);
  assert.ok(antigas.every((v) => v.experimental && /não (?:foi )?validad/i.test(v.descricao)));
  assert.equal(catalogo.versoes.find((v) => v.versao === "1.7.19").experimental, false);
});
