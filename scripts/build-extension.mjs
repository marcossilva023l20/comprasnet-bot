#!/usr/bin/env node
/**
 * Gera public/extension.zip a partir de public/extension/*.
 *
 * Roda automaticamente antes do `next build` (npm prebuild), então o ZIP que a
 * página /extensao oferece para download sempre existe na Vercel — o arquivo é
 * gerado no build e servido como estático, sem precisar escrever em disco em runtime.
 */
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";

/** Arquivos que precisam ir em base64 (não são texto). */
const BINARIOS = /\.(png|jpe?g|gif|ico|woff2?|ttf|otf|wasm|zip)$/i;

const root = process.cwd();
const srcDir = path.join(root, "public", "extension");
const outFile = path.join(root, "public", "extension.zip");

if (!existsSync(srcDir)) {
  console.log("[build:extension] pasta public/extension não encontrada — nada a fazer.");
  process.exit(0);
}

const files = readdirSync(srcDir)
  .filter((f) => !f.startsWith("."))
  .filter((f) => statSync(path.join(srcDir, f)).isFile());

if (files.length === 0) {
  console.log("[build:extension] nenhum arquivo para empacotar.");
  process.exit(0);
}

const zip = new AdmZip();
const arquivosJson = [];

for (const file of files) {
  const conteudo = await readFile(path.join(srcDir, file));
  zip.addFile(`comprasnet-bot/${file}`, conteudo);

  // Versão "aberta" da extensão: permite que a própria extensão grave os
  // arquivos novos na pasta instalada (atualização em um clique), sem precisar
  // baixar e descompactar o ZIP na mão.
  arquivosJson.push(
    BINARIOS.test(file)
      ? { caminho: file, base64: conteudo.toString("base64"), bytes: conteudo.length }
      : { caminho: file, texto: conteudo.toString("utf8"), bytes: conteudo.length },
  );
}

mkdirSync(path.dirname(outFile), { recursive: true });
await writeFile(outFile, zip.toBuffer());

const manifest = JSON.parse(await readFile(path.join(srcDir, "manifest.json"), "utf8"));
const pacote = {
  nome: manifest.name,
  versao: manifest.version,
  geradoPor: "scripts/build-extension.mjs",
  arquivos: arquivosJson,
};
const outPacote = path.join(root, "public", "extension-files.json");
await writeFile(outPacote, JSON.stringify(pacote));

const tamanhoPacote = (JSON.stringify(pacote).length / 1024).toFixed(0);
console.log(
  `[build:extension] public/extension.zip gerado com ${files.length} arquivo(s): ${files.join(", ")}`,
);
console.log(
  `[build:extension] public/extension-files.json gerado (versão ${manifest.version}, ${tamanhoPacote} KB, ${arquivosJson.length} arquivo(s))`,
);
