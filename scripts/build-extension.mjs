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
  // Se já existir pasta gerada localmente, usa-a
  const dirExiste = path.join(root, "public", "extension-releases");
  // Detecta versão pelo ref procurando no config, mas de forma offline-friendly:
  // Se o pacote já foi gerado previamente, pula; caso contrário, tenta local via git e,
  // se falhar por falta de rede/git, aborta a geração histórica sem derrubar o build.
  let local = false;
  try {
    execFileSync("git", ["cat-file", "-e", `${ref}:public/extension/manifest.json`], { stdio: "ignore" });
    local = true;
  } catch { /* Clone raso / offline: tenta URLs públicas */ }
  const fontes = new Map();
  for (const nome of files) {
    if (local) {
      try {
        fontes.set(nome, execFileSync("git", ["show", `${ref}:public/extension/${nome}`], { maxBuffer: 4 * 1024 * 1024 }));
        continue;
      } catch { /* cai para a tentativa remota */ }
    }
    const url = `https://raw.githubusercontent.com/marcossilva023l20/comprasnet-bot/${ref}/public/extension/${nome}`;
    let resposta;
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try {
        resposta = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (resposta.ok) break;
      } catch { /* offline ou rede indisponível */ }
    }
    if (!resposta?.ok) {
      // Offline: não derruba o build, apenas avisa que versões históricas não serão empacotadas
      throw new Error(`OFFLINE_SKIP:${ref}`);
    }
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
const politica = JSON.parse(await readFile(path.join(root, "config", "extension-policy.json"), "utf8"));
if (!/^\d{1,4}(?:\.\d{1,4}){1,3}$/.test(politica.recomendada) || typeof politica.experimentalAtual !== "boolean" || typeof politica.descricaoAtual !== "string") throw new Error("Política de publicação de versões inválida.");
const versoes = [await gerar(fontesAtuais, {
  versao: manifest.version,
  ref: "",
  descricao: politica.descricaoAtual,
  experimental: politica.experimentalAtual,
}, true)];
const vistos = new Set([manifest.version]);
for (const entrada of historicos) {
  if (vistos.has(entrada.versao)) throw new Error(`Versão duplicada no catálogo: ${entrada.versao}.`);
  vistos.add(entrada.versao);
  try {
    versoes.push(await gerar(await fontesHistoricas(entrada.ref), entrada));
  } catch (err) {
    if (String(err?.message || "").startsWith("OFFLINE_SKIP:")) {
      console.warn(`[build:extension] Aviso: pulando versão histórica ${entrada.versao} (offline / referência indisponível). O catálogo local só terá a versão atual.`);
      continue;
    }
    throw err;
  }
}
let recomendada = versoes.find((v) => v.versao === politica.recomendada);
if (!recomendada || recomendada.experimental) {
  // Fallback para dev local: usa a versão atual como a disponível
  const estavel = versoes.find((v) => !v.experimental);
  recomendada = estavel || versoes[0];
  console.warn(`[build:extension] Aviso: versão recomendada ${politica.recomendada} indisponível offline; usando ${recomendada.versao} como padrão local.`);
}
const pastaRecomendada = path.join(root, "public", "extension-releases", recomendada.versao);
await writeFile(path.join(root, "public", "extension-files.json"), await readFile(path.join(pastaRecomendada, "extension-files.json")));
await writeFile(path.join(root, "public", "extension.zip"), await readFile(path.join(pastaRecomendada, "extension.zip")));
await writeFile(path.join(root, "public", "extension-versions.json"), JSON.stringify({ recomendada: recomendada.versao, versoes }));
console.log(`[build:extension] Padrão ${recomendada.versao}; pacote de fontes ${manifest.version} (${politica.experimentalAtual ? "BETA" : "estável"}); catálogo com ${versoes.length} versões completas e hashes SHA-256.`);
