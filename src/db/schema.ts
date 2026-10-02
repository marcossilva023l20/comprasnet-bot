import {
  pgTable,
  serial,
  text,
  timestamp,
  numeric,
  integer,
  varchar,
  boolean,
} from "drizzle-orm/pg-core";

export const propostas = pgTable("propostas", {
  id: serial("id").primaryKey(),
  numeroDispensa: varchar("numero_dispensa", { length: 100 }).notNull(),
  uasg: varchar("uasg", { length: 255 }),
  objeto: text("objeto"),
  dataLimite: varchar("data_limite", { length: 100 }),
  status: varchar("status", { length: 50 }).notNull().default("rascunho"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const itens = pgTable("itens", {
  id: serial("id").primaryKey(),
  propostaId: integer("proposta_id")
    .references(() => propostas.id, { onDelete: "cascade" })
    .notNull(),
  numeroItem: integer("numero_item").notNull(),
  descricao: text("descricao").notNull(),
  descricaoDetalhada: text("descricao_detalhada"),
  quantidade: numeric("quantidade", { precision: 12, scale: 4 }).notNull().default("1"),
  unidade: varchar("unidade", { length: 50 }).notNull().default("Unidade"),
  valorEstimado: numeric("valor_estimado", { precision: 14, scale: 4 }),
  valorUnitario: numeric("valor_unitario", { precision: 14, scale: 4 }),
  marcaFabricante: varchar("marca_fabricante", { length: 255 }),
  modeloVersao: varchar("modelo_versao", { length: 255 }),
  enviado: boolean("enviado").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Proposta = typeof propostas.$inferSelect;
export type NovaPropostas = typeof propostas.$inferInsert;
export type Item = typeof itens.$inferSelect;
export type NovoItem = typeof itens.$inferInsert;
