#!/usr/bin/env node
/** Gera o pacote atual e versões históricas imutáveis, sem acessar o banco. */
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import AdmZip from "adm-zip";

const BINARIOS = /\.(png|jpe?g|gif|ico|woff2?|ttf|otf|wasm|zip)$/i;
const root = process.cwd();
const srcDir = path.join(root, "public", "extension");
const historicos = JSON.parse(await readFile(path.join(root, "config", "extension-releases.json"), "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

if (!existsSync(srcDir)) throw new Error("Pasta public/extension ausente.");
const files = readdirSync(srcDir).filter((f) => !f.startsWith(".") && statSync(path.join(srcDir, f)).isFile()).sort();
const fontesAtuais = new Map(await Promise.all(files.map(async (nome) => [nome, await readFile(path.join(srcDir, nome))])));

async function fontesHistoricas(ref) {
  if (!/^[a-f0-9]{40}$/.test(ref)) throw new Error("Referência histórica inválida.");
  let local = false;
  try {
    execFileSync("git", ["cat-file", "-e", `${ref}:public/extension/manifest.json`], { stdio: "ignore" });
    local = true;
  } catch { /* Clone raso na Vercel: usa somente URLs públicas por SHA fixo. */ }
  const fontes = new Map();
  for (const nome of files) {
    if (local) {
      fontes.set(nome, execFileSync("git", ["show", `${ref}:public/extension/${nome}`], { maxBuffer: 4 * 1024 * 1024 }));
      continue;
    }
    const url = `https://raw.githubusercontent.com/marcossilva023l20/comprasnet-bot/${ref}/public/extension/${nome}`;
    let resposta;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try {
        resposta = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (resposta.ok) break;
      } catch { /* Tentativa limitada; nunca publica uma versão incompleta. */ }
    }
    if (!resposta?.ok) throw new Error(`Não consegui recuperar o arquivo histórico ${ref}/${nome}.`);
    fontes.set(nome, Buffer.from(await resposta.arrayBuffer()));
  }
  return fontes;
}

async function gerar(fontes, informacao, atual = false) {
  const manifest = JSON.parse(fontes.get("manifest.json").toString("utf8"));
  if (!/^\d{1,4}(?:\.\d{1,4}){1,3}$/.test(manifest.version) || manifest.version !== informacao.versao) throw new Error("Versão do manifesto histórico não corresponde ao catálogo.");
  if (manifest.name !== "ComprasNet - Preenchedor de Propostas") throw new Error("Nome da extensão histórica inválido.");
  const zip = new AdmZip();
  const arquivos = [];
  for (const [nome, conteudo] of fontes) {
    zip.addFile(`comprasnet-bot/${nome}`, conteudo);
    arquivos.push(BINARIOS.test(nome)
      ? { caminho: nome, base64: conteudo.toString("base64"), bytes: conteudo.length }
      : { caminho: nome, texto: conteudo.toString("utf8"), bytes: conteudo.length });
  }
  const dados = Buffer.from(JSON.stringify({ nome: manifest.name, versao: manifest.version, geradoPor: "scripts/build-extension.mjs", arquivos }));
  const compactado = zip.toBuffer();
  const prefixo = `/extension-releases/${manifest.version}`;
  const destino = path.join(root, "public", "extension-releases", manifest.version);
  mkdirSync(destino, { recursive: true });
  await writeFile(path.join(destino, "extension-files.json"), dados);
  await writeFile(path.join(destino, "extension.zip"), compactado);
  if (atual) {
    await writeFile(path.join(root, "public", "extension-files.json"), dados);
    await writeFile(path.join(root, "public", "extension.zip"), compactado);
  }
  return {
    ...informacao,
    atual,
    arquivosUrl: `${prefixo}/extension-files.json`,
    zip: { url: `${prefixo}/extension.zip`, nome: `comprasnet-bot-extensao-${manifest.version}.zip` },
    sha256: sha256(dados),
    zipSha256: sha256(compactado),
    arquivos: arquivos.length,
  };
}

const manifest = JSON.parse(fontesAtuais.get("manifest.json").toString("utf8"));
const versoes = [await gerar(fontesAtuais, {
  versao: manifest.version,
  descricao: "Base 1.7.19 com seletor de versões. O Modo Disputa continua sem envio automático.",
  experimental: false,
}, true)];
const vistos = new Set([manifest.version]);
for (const entrada of historicos) {
  if (vistos.has(entrada.versao)) throw new Error(`Versão duplicada no catálogo: ${entrada.versao}.`);
  vistos.add(entrada.versao);
  versoes.push(await gerar(await fontesHistoricas(entrada.ref), entrada));
}
await writeFile(path.join(root, "public", "extension-versions.json"), JSON.stringify({ recomendada: manifest.version, versoes }));
console.log(`[build:extension] Versão atual ${manifest.version}: ${files.length} arquivos; catálogo com ${versoes.length} versões completas e hashes SHA-256.`);
