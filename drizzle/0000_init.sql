CREATE TABLE "itens" (
	"id" serial PRIMARY KEY NOT NULL,
	"proposta_id" integer NOT NULL,
	"numero_item" integer NOT NULL,
	"descricao" text NOT NULL,
	"descricao_detalhada" text,
	"quantidade" numeric(12, 4) DEFAULT '1' NOT NULL,
	"unidade" varchar(50) DEFAULT 'Unidade' NOT NULL,
	"valor_estimado" numeric(14, 4),
	"valor_unitario" numeric(14, 4),
	"marca_fabricante" varchar(255),
	"modelo_versao" varchar(255),
	"enviado" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "propostas" (
	"id" serial PRIMARY KEY NOT NULL,
	"numero_dispensa" varchar(100) NOT NULL,
	"uasg" varchar(255),
	"objeto" text,
	"data_limite" varchar(100),
	"status" varchar(50) DEFAULT 'rascunho' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "itens" ADD CONSTRAINT "itens_proposta_id_propostas_id_fk" FOREIGN KEY ("proposta_id") REFERENCES "public"."propostas"("id") ON DELETE cascade ON UPDATE no action;