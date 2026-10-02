import assert from "node:assert/strict";
import test from "node:test";
import {
  casarProposta,
  extrairUasg,
  montarNumeroDispensa,
  normalizarItensDaPagina,
  somenteDigitos,
  textoComparavel,
  type PropostaResumo,
} from "../src/lib/proposta-match";

const candidatas: PropostaResumo[] = [
  {
    id: 10,
    numeroDispensa: "17016205900012025",
    uasg: "170162 - ALFÂNDEGA DA RFB EM FOZ DO IGUAÇU",
    objeto: "Manutenção de balança rodoviária",
    updatedAt: "2026-09-30T10:00:00.000Z",
  },
  {
    id: 11,
    numeroDispensa: "17016205900012025",
    uasg: "170162",
    objeto: "Registro antigo da mesma compra",
    updatedAt: "2026-01-05T10:00:00.000Z",
  },
  {
    id: 12,
    numeroDispensa: "15812305900072024",
    uasg: "158123 - OUTRA UNIDADE",
    objeto: "Outro objeto",
    updatedAt: "2026-08-01T10:00:00.000Z",
  },
];

test("normaliza UASG e dígitos vindos da página", () => {
  assert.equal(extrairUasg("170162 - ALFÂNDEGA DA RFB EM FOZ DO IGUAÇU"), "170162");
  assert.equal(extrairUasg("UASG 158123"), "158123");
  assert.equal(extrairUasg(" 17016 "), "17016", "UASG de 5 dígitos também é aceita");
  assert.equal(extrairUasg("sem número por aqui"), "");
  assert.equal(somenteDigitos("Nº 17016205900012025/2025"), "170162059000120252025");
  assert.equal(textoComparavel("  MANUTENÇÃO   de Balanças "), "manutencao de balancas");
});

test("casa pelo número da compra idêntico (e desempata pela mais recente)", () => {
  const resultado = casarProposta(candidatas, { numeroCompra: "17016205900012025" });
  assert.equal(resultado.proposta?.id, 10);
  assert.match(resultado.motivo, /idêntico/);
});

test("casa por número parcial e por UASG", () => {
  const parcial = casarProposta(candidatas, { numeroCompra: "05900012025" });
  assert.equal(parcial.proposta?.id, 10);

  const porUasg = casarProposta(candidatas, { uasg: "158123 - OUTRA UNIDADE" });
  assert.equal(porUasg.proposta?.id, 12);
  assert.match(porUasg.motivo, /UASG/);
});

test("sem correspondência devolve null e explica", () => {
  const resultado = casarProposta(candidatas, { uasg: "999999", numeroCompra: "99999905900012030" });
  assert.equal(resultado.proposta, null);
  assert.match(resultado.motivo, /nova será criada/);
});

test("monta um nome utilizável quando precisa criar a proposta", () => {
  assert.equal(montarNumeroDispensa({ numeroCompra: "17016205900012025" }), "17016205900012025");
  assert.equal(montarNumeroDispensa({ numeroDispensa: "Dispensa 12/2025" }), "Dispensa 12/2025");
  assert.equal(montarNumeroDispensa({ uasg: "170162 - ALFÂNDEGA" }), "UASG 170162 (importado da página)");
  assert.equal(montarNumeroDispensa({}), "Importado da página do ComprasNet");
});

test("normaliza os itens lidos na página (valores BR, defaults e ruído)", () => {
  const { itens, ignorados, duplicados, avisos } = normalizarItensDaPagina([
    {
      numeroItem: "1",
      descricao: "MANUTENÇÃO E REPARO EM BALANÇAS MECÂNICAS",
      quantidade: "1",
      unidade: "UNIDADE",
      valorEstimado: "R$ 37.553,3300",
    },
    { numeroItem: 2, descricao: "Item sem valor", valorEstimado: "não informado", quantidade: "" },
    { numeroItem: "1", descricao: "Duplicado da página" },
    { descricao: "Item sem número legível" },
  ]);

  assert.equal(itens.length, 2);
  assert.deepEqual(itens[0], {
    numeroItem: 1,
    descricao: "MANUTENÇÃO E REPARO EM BALANÇAS MECÂNICAS",
    descricaoDetalhada: null,
    quantidade: "1",
    unidade: "UNIDADE",
    valorEstimado: "37553.3300",
    valorUnitario: null,
    marcaFabricante: null,
    modeloVersao: null,
  });
  assert.equal(itens[1].quantidade, "1", "quantidade em branco vira 1 (NOT NULL no banco)");
  assert.equal(itens[1].valorEstimado, null, "valor não numérico vira null em vez de derrubar a importação");
  assert.equal(itens[1].unidade, "Unidade", "unidade em branco usa o padrão");
  assert.equal(duplicados, 1);
  assert.equal(ignorados.length, 1);
  assert.equal(avisos.length, 2, "um aviso para o valor não reconhecido e outro para o item repetido");
  assert.ok(avisos.some((a) => /não reconhecido/.test(a)));
  assert.ok(avisos.some((a) => /repetido/.test(a)));
});

test("limita a quantidade de itens e avisa", () => {
  const muitos = Array.from({ length: 505 }, (_, i) => ({ numeroItem: i + 1, descricao: `Item ${i + 1}` }));
  const { itens, avisos } = normalizarItensDaPagina(muitos);
  assert.equal(itens.length, 500);
  assert.ok(avisos.some((a) => /mais de 500/.test(a)));
});
