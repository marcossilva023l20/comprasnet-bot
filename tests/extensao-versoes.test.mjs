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
  assert.equal(catalogo.versoes[0].versao, "1.8.14");
  assert.equal(catalogo.versoes[0].experimental, true);
  assert.equal(catalogo.versoes.find((v) => v.versao === catalogo.recomendada).experimental, false);
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

test("versões BETA com automação de lances nunca são a recomendada", () => {
  const betas = catalogo.versoes.filter((v) => /^1\.8\./.test(v.versao));
  assert.equal(betas.length, 14);
  assert.ok(betas.every((v) => v.experimental && /não (?:foi )?validad/i.test(v.descricao)));
  assert.equal(catalogo.versoes.find((v) => v.versao === "1.8.13").ref, "09b9a388596647686fd26fd5bbf3ef60bf49594a");
  assert.equal(catalogo.versoes.find((v) => v.versao === "1.8.12").ref, "271dc4a191ab2588b75fe25d1254e45d7525befc");
  assert.equal(catalogo.versoes.find((v) => v.versao === "1.8.11").ref, "6df414b9c86c5ac615ea082df30fdca13afa1a46");
  assert.equal(catalogo.versoes.find((v) => v.versao === "1.8.10").ref, "91b8a745ab8d5fa3a4ff1b448293b5f62ac8406a");
  assert.equal(catalogo.versoes.find((v) => v.versao === "1.8.9").ref, "9926263dab68b59743a908b0a9f21734f7880bb0");
  assert.equal(catalogo.versoes.find((v) => v.versao === "1.8.8").ref, "5839450cd44d216f53671942411c9ace60eb224a");
  assert.equal(catalogo.versoes.find((v) => v.versao === "1.7.19").experimental, false);
  const estavel = catalogo.versoes.find((v) => v.versao === catalogo.recomendada);
  assert.equal(estavel.ref, "cf1c579807b70144e4234e15ea80fef999f0b75d");
  const manifestoEmUso = JSON.parse(readFileSync(new URL("public/extension/manifest.json", root), "utf8"));
  assert.equal(manifestoEmUso.version, "1.8.14");
  assert.ok(manifestoEmUso.description.length <= 132, "a descrição do Chrome precisa respeitar o limite do manifesto");
  assert.equal(catalogo.versoes[0].versao, manifestoEmUso.version);
  const pacoteLegado = JSON.parse(readFileSync(new URL("public/extension-files.json", root), "utf8"));
  const manifestoDefault = JSON.parse(pacoteLegado.arquivos.find((a) => a.caminho === "manifest.json").texto);
  assert.equal(manifestoDefault.version, "1.7.20", "o ZIP legado precisa ficar na versão estável recomendada");
});
