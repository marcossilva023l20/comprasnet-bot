import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { neon } from "@neondatabase/serverless";
import { Pool } from "pg";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

// Use Neon HTTP driver when on Vercel / serverless (DATABASE_URL contains neon.tech)
// Use standard pg driver for local development
function createDb() {
  if (databaseUrl!.includes("neon.tech") || databaseUrl!.includes("neon.database")) {
    const sql = neon(databaseUrl!);
    return drizzleNeon(sql, { schema });
  }
  // Local PostgreSQL
  const pool = new Pool({ connectionString: databaseUrl });
  return drizzlePg(pool, { schema });
}

export const db = createDb();
