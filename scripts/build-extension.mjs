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
for (const file of files) {
  zip.addFile(`comprasnet-bot/${file}`, await readFile(path.join(srcDir, file)));
}

mkdirSync(path.dirname(outFile), { recursive: true });
await writeFile(outFile, zip.toBuffer());

console.log(
  `[build:extension] public/extension.zip gerado com ${files.length} arquivo(s): ${files.join(", ")}`,
);
