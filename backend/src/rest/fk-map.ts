import type pg from "pg";
import { pool } from "../db.js";

export type ForeignKey = { table: string; column: string; refTable: string; refColumn: string };

let cache: ForeignKey[] | null = null;

/** One-time (cached) introspection of public-schema foreign keys, used to resolve
 * embedded-resource selects like `select=*,conversation_assignments(*)` the way
 * PostgREST infers relationships automatically. */
export async function getForeignKeys(): Promise<ForeignKey[]> {
  if (cache) return cache;
  const { rows } = await pool.query<{
    table_name: string;
    column_name: string;
    ref_table: string;
    ref_column: string;
  }>(`
    SELECT
      tc.table_name AS table_name,
      kcu.column_name AS column_name,
      ccu.table_name AS ref_table,
      ccu.column_name AS ref_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `);
  cache = rows.map((r) => ({
    table: r.table_name,
    column: r.column_name,
    refTable: r.ref_table,
    refColumn: r.ref_column,
  }));
  return cache;
}

export function invalidateForeignKeyCache() {
  cache = null;
}

/** Finds how `relation` relates to `baseTable`: either baseTable has a FK column
 * pointing at relation (to-one), or relation has a FK column pointing at baseTable (to-many). */
export function resolveRelation(fks: ForeignKey[], baseTable: string, relation: string) {
  const toOne = fks.find((fk) => fk.table === baseTable && fk.refTable === relation);
  if (toOne) return { kind: "to-one" as const, fk: toOne };
  const toMany = fks.find((fk) => fk.table === relation && fk.refTable === baseTable);
  if (toMany) return { kind: "to-many" as const, fk: toMany };
  return null;
}
