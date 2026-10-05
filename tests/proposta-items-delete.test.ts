import assert from "node:assert/strict";
import test from "node:test";
import type { NextRequest } from "next/server";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { getDb } from "../src/db";
import { itens } from "../src/db/schema";
import { DELETE } from "../src/app/api/propostas/[id]/itens/route";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

function interceptarDelete(idsRemovidos: number[]) {
  const instancia = getDb().db as unknown as Record<string, unknown>;
  const descritorOriginal = Object.getOwnPropertyDescriptor(instancia, "delete");
  let consulta: { tabela: unknown; sql: string; params: unknown[] } | null = null;

  Object.defineProperty(instancia, "delete", {
    configurable: true,
    writable: true,
    value: (tabela: unknown) => ({
      where: (condicao: SQL) => {
        const query = new PgDialect().sqlToQuery(condicao);
        consulta = { tabela, sql: query.sql, params: query.params };
        return { returning: async () => idsRemovidos.map((id) => ({ id })) };
      },
    }),
  });

  return {
    obterConsulta: () => consulta,
    restaurar: () => {
      if (descritorOriginal) Object.defineProperty(instancia, "delete", descritorOriginal);
      else delete instancia.delete;
    },
  };
}

function requisicao(body: unknown) {
  return new Request("http://localhost/api/propostas/42/itens", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as NextRequest;
}

test("exclusão selecionada sempre limita os IDs à proposta da rota", async () => {
  const spy = interceptarDelete([7, 8]);
  try {
    const response = await DELETE(requisicao({ ids: [7, 7, 8] }), {
      params: Promise.resolve({ id: "42" }),
    });
    const body = await response.json();
    const consulta = spy.obterConsulta();

    assert.equal(response.status, 200);
    assert.equal(body.removidos, 2);
    assert.deepEqual(body.ids, [7, 8]);
    assert.ok(consulta);
    assert.equal(consulta.tabela, itens);
    assert.match(consulta.sql, /"itens"\."proposta_id" = \$1/);
    assert.match(consulta.sql, /"itens"\."id" in \(\$2, \$3\)/);
    assert.deepEqual(consulta.params, [42, 7, 8]);
  } finally {
    spy.restaurar();
  }
});

test("excluir todos também fica restrito à proposta da rota", async () => {
  const spy = interceptarDelete([7, 8]);
  try {
    const response = await DELETE(requisicao({ todos: true }), {
      params: Promise.resolve({ id: "42" }),
    });
    const consulta = spy.obterConsulta();

    assert.equal(response.status, 200);
    assert.ok(consulta);
    assert.equal(consulta.tabela, itens);
    assert.match(consulta.sql, /"itens"\."proposta_id" = \$1/);
    assert.doesNotMatch(consulta.sql, /"itens"\."id"/);
    assert.deepEqual(consulta.params, [42]);
  } finally {
    spy.restaurar();
  }
});

test("IDs selecionados inválidos são recusados antes de consultar o banco", async () => {
  const spy = interceptarDelete([]);
  try {
    const response = await DELETE(requisicao({ ids: [7, "8"] }), {
      params: Promise.resolve({ id: "42" }),
    });
    assert.equal(response.status, 400);
    assert.equal(spy.obterConsulta(), null);
  } finally {
    spy.restaurar();
  }
});
