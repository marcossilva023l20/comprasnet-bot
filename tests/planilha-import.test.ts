import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { lerLinhasDaPlanilha, montarPayloadImportacao } from "../src/lib/planilha-import";
import {
  COLUNAS_EXPORTACAO,
  FORMATO_QUATRO_CASAS,
  LARGURAS_EXPORTACAO,
  aplicarFormatoValores,
  montarLinhasExportacao,
} from "../src/lib/planilha-export";
import { parseLocalizedNumber } from "../src/lib/numbers";

/** Linha no formato entregue por `XLSX.utils.sheet_to_json(sheet, { defval: "" })`. */
const linhaExportada = (over: Record<string, unknown> = {}) => ({
  Item: 1,
  Descrição: "PNEU 175/70 R13",
  "Descrição Detalhada": "PNEU 175/70 R13 82T",
  Quantidade: 4,
  Unidade: "UNIDADE",
  "Valor Estimado (R$)": 37553.33,
  "Valor Unitário (R$)": 1234.56,
  "Valor Mínimo (R$)": 800.00,
  "Marca/Fabricante": "MICHELIN",
  "Modelo/Versão": "PRIMACY 4",
  Enviado: "Não",
  ...over,
});

test("planilha exportada pelo sistema: lê número, valores BR e colunas presentes", () => {
  const { linhas, modo, invalidos, duplicados } = lerLinhasDaPlanilha([
    linhaExportada(),
    linhaExportada({ Item: 2, Descrição: "CÂMARA DE AR", "Valor Unitário (R$)": "R$ 1.234,50" }),
  ]);

  assert.equal(modo, "atualizar");
  assert.deepEqual(invalidos, []);
  assert.deepEqual(duplicados, []);
  assert.equal(linhas.length, 2);
  assert.equal(linhas[0].numeroItem, 1);
  assert.equal(linhas[1].numeroItem, 2);
  assert.equal(linhas[0].descricao, "PNEU 175/70 R13");
  assert.equal(linhas[0].quantidade, "4");
  assert.equal(linhas[0].valorEstimado, "37553.33");
  assert.equal(linhas[1].valorUnitario, "1234.50");
  assert.equal(linhas[0].valorMinimo, "800");
  assert.equal(linhas[0].marcaFabricante, "MICHELIN");
  assert.deepEqual(linhas[0].colunas, {
    descricaoDetalhada: true,
    quantidade: true,
    unidade: true,
    valorEstimado: true,
    valorUnitario: true,
    valorMinimo: true,
    marcaFabricante: true,
    modeloVersao: true,
  });
});

test("planilha antiga sem a coluna Valor Mínimo importa normalmente", () => {
  const resultado = lerLinhasDaPlanilha([
    {
      Item: 1,
      Descrição: "ITEM DE PLANILHA ANTIGA",
      Quantidade: 2,
      "Valor Unitário (R$)": "67,4100",
    },
  ]);

  assert.deepEqual(resultado.invalidos, []);
  assert.equal(resultado.linhas.length, 1);
  assert.equal(resultado.linhas[0].descricao, "ITEM DE PLANILHA ANTIGA");
  assert.equal(resultado.linhas[0].valorMinimo, null);
  assert.equal(resultado.linhas[0].colunas.valorMinimo, false);
});

test("colunas ausentes não são tocadas e célula em branco em coluna presente apaga o valor", () => {
  const { linhas } = lerLinhasDaPlanilha([
    { Item: 1, Descrição: "PARAFUSO", "Valor Unitário (R$)": "", "Valor Mínimo (R$)": "" },
    { Nº: 2, Descricao: "ARRUELA", "Marca/Fabricante": "  " },
  ]);

  // 1ª linha: Item, Descrição, Valor Unitário e Valor Mínimo vieram na planilha
  assert.equal(linhas[0].colunas.valorUnitario, true);
  assert.equal(linhas[0].valorUnitario, null); // branco = apagar
  assert.equal(linhas[0].colunas.valorMinimo, true);
  assert.equal(linhas[0].valorMinimo, null); // em branco apaga o valor mínimo
  assert.equal(linhas[0].colunas.marcaFabricante, false);
  assert.equal(linhas[0].colunas.quantidade, false);
  assert.equal(linhas[0].quantidade, null);
  assert.equal(linhas[0].marcaFabricante, null);

  // 2ª linha: Marca em branco apaga; Descrição lida do alias "Descricao"
  assert.equal(linhas[1].numeroItem, 2);
  assert.equal(linhas[1].marcaFabricante, null);
  assert.equal(linhas[1].colunas.marcaFabricante, true);
  assert.equal(linhas[1].colunas.valorMinimo, false); // coluna ausente preserva
  assert.equal(linhas[1].descricao, "ARRUELA");
});

test("planilha sem números é somada à proposta, depois do último item", () => {
  const { linhas, modo } = lerLinhasDaPlanilha(
    [{ Descrição: "CANETA", Quantidade: 10 }, { Descrição: "LÁPIS", Quantidade: 5 }],
    { numeroBase: 7 },
  );

  assert.equal(modo, "adicionar");
  assert.deepEqual(linhas.map((l) => l.numeroItem), [8, 9]);
});

test("planilha mista: quem tem número atualiza, quem não tem entra depois do maior número", () => {
  const { linhas, modo } = lerLinhasDaPlanilha(
    [
      { Item: 3, Descrição: "ITEM TRÊS" },
      { Descrição: "ITEM NOVO SEM NÚMERO" },
      { Item: 1, Descrição: "ITEM UM" },
    ],
    { numeroBase: 2 },
  );

  assert.equal(modo, "atualizar");
  assert.deepEqual(linhas.map((l) => l.numeroItem), [3, 4, 1]);
  assert.deepEqual(linhas.map((l) => l.descricao), ["ITEM TRÊS", "ITEM NOVO SEM NÚMERO", "ITEM UM"]);
});

test("linhas sem descrição são ignoradas sem derrubar a importação", () => {
  const { linhas, ignoradasSemDescricao } = lerLinhasDaPlanilha([
    { Item: 1, Descrição: "" },
    { Item: 2, Descrição: "   " },
    { Item: 3, Descrição: "VÁLIDO" },
  ]);

  assert.equal(ignoradasSemDescricao, 2);
  assert.deepEqual(linhas.map((l) => l.descricao), ["VÁLIDO"]);
});

test("números repetidos na planilha são recusados com a linha de cada um", () => {
  const { linhas, duplicados, invalidos } = lerLinhasDaPlanilha([
    { Item: 5, Descrição: "PRIMEIRO" },
    { Item: 5, Descrição: "SEGUNDO" },
  ]);

  assert.deepEqual(linhas, []);
  assert.deepEqual(duplicados, [5]);
  assert.equal(invalidos.length, 1);
  assert.match(invalidos[0], /linha 3: item 5 repetido/);
});

test("valores inválidos apontam a linha e o campo", () => {
  const { invalidos } = lerLinhasDaPlanilha([
    { Item: "abc", Descrição: "NÚMERO RUIM" },
    { Item: 2, Descrição: "VALOR RUIM", "Valor Unitário (R$)": "mil reais" },
    { Item: 3, Descrição: "QUANTIDADE RUIM", Quantidade: "vários" },
    { Item: 4, Descrição: "MÍNIMO RUIM", "Valor Mínimo (R$)": "quase cem" },
  ]);

  assert.equal(invalidos.length, 4);
  assert.match(invalidos[0], /linha 2: número do item/);
  assert.match(invalidos[1], /linha 3: valor unitário/);
  assert.match(invalidos[2], /linha 4: quantidade/);
  assert.match(invalidos[3], /linha 5: valor mínimo/);
});

test("payload do Postgres usa snake_case e sinaliza as colunas presentes", () => {
  const { linhas } = lerLinhasDaPlanilha([{ Item: 9, Descrição: "ITEM", "Marca/Fabricante": "ACME" }]);

  assert.deepEqual(montarPayloadImportacao(linhas), [
    {
      numero_item: 9,
      descricao: "ITEM",
      descricao_detalhada: null,
      quantidade: null,
      unidade: null,
      valor_estimado: null,
      valor_unitario: null,
      valor_minimo: null,
      marca_fabricante: "ACME",
      modelo_versao: null,
      set_descricao_detalhada: false,
      set_quantidade: false,
      set_unidade: false,
      set_valor_estimado: false,
      set_valor_unitario: false,
      set_valor_minimo: false,
      set_marca_fabricante: true,
      set_modelo_versao: false,
    },
  ]);
});

test("ida e volta: exportar → editar no Excel → importar devolve os mesmos itens", () => {
  const itens = [
    {
      numeroItem: 1,
      descricao: "PNEU 175/70 R13",
      descricaoDetalhada: "PNEU 175/70 R13 82T DIANTEIRO",
      quantidade: "4.0000",
      unidade: "UNIDADE",
      valorEstimado: "37553.3300",
      valorUnitario: "1234.5600",
      valorMinimo: "800.0000",
      marcaFabricante: "MICHELIN",
      modeloVersao: "PRIMACY 4",
      enviado: true,
    },
    {
      numeroItem: 7,
      descricao: "CAMARA DE AR 175/70",
      descricaoDetalhada: null,
      quantidade: "2.0000",
      unidade: "PAR",
      valorEstimado: null,
      valorUnitario: null,
      valorMinimo: null,
      marcaFabricante: null,
      modeloVersao: null,
      enviado: false,
    },
  ];

  // 1) exporta igual ao GET /api/propostas/:id/exportar
  const linhas = montarLinhasExportacao(itens);
  assert.deepEqual(Object.keys(linhas[0]), [...COLUNAS_EXPORTACAO]);
  assert.equal(LARGURAS_EXPORTACAO.length, COLUNAS_EXPORTACAO.length);
  const ws = XLSX.utils.json_to_sheet(linhas, { header: [...COLUNAS_EXPORTACAO] });
  ws["!cols"] = LARGURAS_EXPORTACAO.map((wch) => ({ wch }));
  aplicarFormatoValores(ws, linhas.length);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Itens");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  // 2) o usuário abre no Excel, edita e salva — aqui só simulamos a releitura
  const lido = XLSX.read(buffer, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(lido.Sheets[lido.SheetNames[0]], { defval: "" });

  // 3) importa
  const { linhas: importadas, modo, invalidos, ignoradasSemDescricao } = lerLinhasDaPlanilha(rows);

  assert.deepEqual(invalidos, []);
  assert.equal(ignoradasSemDescricao, 0);
  assert.equal(modo, "atualizar");
  assert.equal(importadas.length, 2);

  const original = (indice: number) => ({
    numeroItem: itens[indice].numeroItem,
    descricao: itens[indice].descricao,
    descricaoDetalhada: itens[indice].descricaoDetalhada,
    quantidade: Number(itens[indice].quantidade),
    unidade: itens[indice].unidade,
    valorEstimado: itens[indice].valorEstimado === null ? null : Number(itens[indice].valorEstimado),
    valorUnitario: itens[indice].valorUnitario === null ? null : Number(itens[indice].valorUnitario),
    valorMinimo: itens[indice].valorMinimo === null ? null : Number(itens[indice].valorMinimo),
    marcaFabricante: itens[indice].marcaFabricante,
    modeloVersao: itens[indice].modeloVersao,
  });
  const relido = (indice: number) => ({
    numeroItem: importadas[indice].numeroItem,
    descricao: importadas[indice].descricao,
    descricaoDetalhada: importadas[indice].descricaoDetalhada,
    quantidade: importadas[indice].quantidade === null ? null : Number(importadas[indice].quantidade),
    unidade: importadas[indice].unidade,
    valorEstimado: importadas[indice].valorEstimado === null ? null : Number(importadas[indice].valorEstimado),
    valorUnitario: importadas[indice].valorUnitario === null ? null : Number(importadas[indice].valorUnitario),
    valorMinimo: importadas[indice].valorMinimo === null ? null : Number(importadas[indice].valorMinimo),
    marcaFabricante: importadas[indice].marcaFabricante,
    modeloVersao: importadas[indice].modeloVersao,
  });

  assert.deepEqual(relido(0), original(0));
  assert.deepEqual(relido(1), original(1));
  // todas as colunas vieram: a importação atualiza tudo o que foi exportado
  assert.deepEqual(importadas[1].colunas, {
    descricaoDetalhada: true,
    quantidade: true,
    unidade: true,
    valorEstimado: true,
    valorUnitario: true,
    valorMinimo: true,
    marcaFabricante: true,
    modeloVersao: true,
  });
});

test("exportação: valores unitário, estimado e mínimo saem com 4 casas (44,0000)", () => {
  const itens = [
    {
      numeroItem: 1,
      descricao: "FONE OUVIDO",
      descricaoDetalhada: null,
      quantidade: "184.0000",
      unidade: "Unidade",
      valorEstimado: "44.0000",
      valorUnitario: "44.0000",
      valorMinimo: "12.3400",
      marcaFabricante: "ACME",
      modeloVersao: "X1",
      enviado: false,
    },
  ];

  const linhas = montarLinhasExportacao(itens);
  const ws = XLSX.utils.json_to_sheet(linhas, { header: [...COLUNAS_EXPORTACAO] });
  aplicarFormatoValores(ws, linhas.length);

  const coluna = (nome: string) => String.fromCharCode(65 + COLUNAS_EXPORTACAO.indexOf(nome as never));
  const estimado = ws[`${coluna("Valor Estimado (R$)")}2`];
  const unitario = ws[`${coluna("Valor Unitário (R$)")}2`];
  const minimo = ws[`${coluna("Valor Mínimo (R$)")}2`];

  assert.equal(unitario.v, 44);
  assert.equal(unitario.z, FORMATO_QUATRO_CASAS);
  assert.equal(estimado.z, FORMATO_QUATRO_CASAS);
  assert.equal(minimo.v, 12.34);
  assert.equal(minimo.z, FORMATO_QUATRO_CASAS);

  // formatado, o Excel mostra exatamente "44,0000" (pt-BR)
  const exibido = Number(unitario.v).toLocaleString("pt-BR", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
  assert.equal(exibido, "44,0000");

  // e o texto continua sendo lido sem perder valor na reimportação
  assert.equal(parseLocalizedNumber(exibido), "44.0000");
});
