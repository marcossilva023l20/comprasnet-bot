import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

// A versão solicitada pelo usuário: arquivos originais do commit acd497f.
const originais = {
  "atualizar.html": "37a0ffe4962caf32e5fd83ae041441d9101901d0c543d57797d81e976dff007c",
  "atualizar.js": "f4f2df79c0a484e89870c3e406ca896f44325d65cdecf8c6174192d03231a6df",
  "background.js": "e1a3d8a6cdaf451a18f895717e9b9aa5316a9a26b80beaf59776f354fa496243",
  "content.js": "3eb7693a77b09974546c5217b9ccf96f70a8a01e8d849897c5a60ea686fb6793",
  "icon128.png": "c1b320cc5089c3e4ae12472ff3b255819c3a9892639bbe28d877f25be9eec19b",
  "icon16.png": "25d88a1b9279d4c0a74f86182d9468412c56082ae15a5a6833a5075489e48ef9",
  "icon48.png": "f07c478a6a0b7898f100e2fb6331a02731f9d38af506bedf4a2e83b0e72adfeb",
  "manifest.json": "10b7c581f57b7ed302d77963239200116b7304375f7424c389aced805a551af7",
  "popup.html": "03c94d68ab4bab44b12f12372c84c722b67df8c4492de8e368ebcbad28e922b1",
  "popup.js": "8c97c85b2dbbf4dc7aa39636beba9085206f5edc8d84780b23f3263eb7cd9e5f"
};

test("a base de propostas continua a 1.7.19; só o atualizador e manifesto evoluem", () => {
  const pasta = new URL("../public/extension/", import.meta.url);
  assert.deepEqual(readdirSync(pasta).sort(), Object.keys(originais).sort());
  for (const [nome, hash] of Object.entries(originais)) {
    if (["atualizar.html", "atualizar.js", "manifest.json"].includes(nome)) continue;
    assert.equal(createHash("sha256").update(readFileSync(new URL(nome, pasta))).digest("hex"), hash, nome);
  }
});

test("o pacote histórico 1.7.19 permanece idêntico aos dez arquivos restaurados", () => {
  const pacote = JSON.parse(readFileSync(new URL("../public/extension-releases/1.7.19/extension-files.json", import.meta.url), "utf8"));
  assert.equal(pacote.versao, "1.7.19");
  assert.deepEqual(pacote.arquivos.map((a) => a.caminho).sort(), Object.keys(originais).sort());
  for (const arquivo of pacote.arquivos) {
    const bytes = arquivo.texto !== undefined ? Buffer.from(arquivo.texto, "utf8") : Buffer.from(arquivo.base64, "base64");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), originais[arquivo.caminho], arquivo.caminho);
  }
});
