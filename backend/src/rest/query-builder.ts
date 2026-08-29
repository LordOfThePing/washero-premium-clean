import { getForeignKeys, resolveRelation } from "./fk-map.js";

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function quoteIdent(name: string): string {
  if (!IDENT_RE.test(name)) throw new HttpError(400, `invalid identifier: ${name}`);
  return `"${name}"`;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type SelectField =
  | { kind: "star" }
  | { kind: "column"; column: string; alias?: string; jsonPath?: string[] }
  | { kind: "embed"; relation: string; alias?: string; subFields: SelectField[] };

function splitTopLevel(input: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === sep && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.length) parts.push(current);
  return parts;
}

export function parseSelect(select: string | undefined): SelectField[] {
  if (!select || select.trim() === "") return [{ kind: "star" }];
  return splitTopLevel(select, ",")
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => parseSelectField(raw));
}

function parseSelectField(raw: string): SelectField {
  let alias: string | undefined;
  let rest = raw;
  const colonIdx = rest.indexOf(":");
  const parenIdx = rest.indexOf("(");
  if (colonIdx !== -1 && (parenIdx === -1 || colonIdx < parenIdx)) {
    alias = rest.slice(0, colonIdx).trim();
    rest = rest.slice(colonIdx + 1).trim();
  }

  const embedMatch = rest.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)$/s);
  if (embedMatch) {
    const relation = embedMatch[1];
    const subFields = parseSelect(embedMatch[2]);
    return { kind: "embed", relation, alias, subFields };
  }

  if (rest === "*") return { kind: "star" };

  const jsonParts = rest.split("->").map((p) => p.replace(/^>/, ""));
  const column = jsonParts[0];
  const jsonPath = jsonParts.length > 1 ? jsonParts.slice(1) : undefined;
  return { kind: "column", column, alias, jsonPath };
}

function renderColumnExpr(f: Extract<SelectField, { kind: "column" }>, tableAlias: string): string {
  const base = `${tableAlias}.${quoteIdent(f.column)}`;
  if (!f.jsonPath) {
    return f.alias ? `${base} AS ${quoteIdent(f.alias)}` : base;
  }
  let expr = base;
  f.jsonPath.forEach((seg, i) => {
    const clean = seg.replace(/>>?$/, "").trim();
    const op = seg.endsWith("->") || i < f.jsonPath!.length - 1 ? "->" : "->>";
    expr += `${op}'${clean.replace(/'/g, "''")}'`;
  });
  const alias = f.alias ?? f.column;
  return `${expr} AS ${quoteIdent(alias)}`;
}

async function renderEmbed(f: Extract<SelectField, { kind: "embed" }>, baseTable: string, baseAlias: string): Promise<string> {
  const fks = await getForeignKeys();
  const rel = resolveRelation(fks, baseTable, f.relation);
  if (!rel) throw new HttpError(400, `Could not find relationship between ${baseTable} and ${f.relation}`);
  const subAlias = "sub";
  const subCols = await renderSelectList(f.subFields, f.relation, subAlias);
  const outAlias = f.alias ?? f.relation;
  if (rel.kind === "to-many") {
    return `(SELECT coalesce(jsonb_agg(to_jsonb(${subAlias}.*)), '[]'::jsonb) FROM (SELECT ${subCols} FROM ${quoteIdent(f.relation)} ${subAlias} WHERE ${subAlias}.${quoteIdent(rel.fk.column)} = ${baseAlias}.${quoteIdent(rel.fk.refColumn)}) ${subAlias}) AS ${quoteIdent(outAlias)}`;
  }
  return `(SELECT to_jsonb(${subAlias}.*) FROM (SELECT ${subCols} FROM ${quoteIdent(f.relation)} ${subAlias} WHERE ${subAlias}.${quoteIdent(rel.fk.refColumn)} = ${baseAlias}.${quoteIdent(rel.fk.column)}) ${subAlias}) AS ${quoteIdent(outAlias)}`;
}

export async function renderSelectList(fields: SelectField[], table: string, tableAlias: string): Promise<string> {
  const parts: string[] = [];
  for (const f of fields) {
    if (f.kind === "star") parts.push(`${tableAlias}.*`);
    else if (f.kind === "column") parts.push(renderColumnExpr(f, tableAlias));
    else parts.push(await renderEmbed(f, table, tableAlias));
  }
  return parts.join(", ");
}

// ---------------- Filters ----------------

export type FilterClause = { sql: string; params: unknown[] };

const OPERATORS = new Set([
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is", "cs", "cd", "fts", "plfts",
]);

function likeToSql(value: string): string {
  return value.replace(/\*/g, "%");
}

function parseInList(value: string): string[] {
  const inner = value.startsWith("(") && value.endsWith(")") ? value.slice(1, -1) : value;
  if (inner === "") return [];
  const items: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      items.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  items.push(current);
  return items;
}

/** Builds one `column OP value` clause. `paramIndex` is a mutable-by-closure counter
 * supplied by the caller so params stay correctly numbered across many clauses. */
function buildOpClause(column: string, opAndValue: string, nextParam: () => number): FilterClause {
  let negate = false;
  let rest = opAndValue;
  if (rest.startsWith("not.")) {
    negate = true;
    rest = rest.slice(4);
  }
  const dotIdx = rest.indexOf(".");
  const op = dotIdx === -1 ? rest : rest.slice(0, dotIdx);
  const rawValue = dotIdx === -1 ? "" : rest.slice(dotIdx + 1);
  const col = `${quoteIdent(column)}`;

  if (op === "is") {
    const v = rawValue.toLowerCase();
    const expr =
      v === "null" ? `${col} IS NULL` : v === "true" ? `${col} IS TRUE` : v === "false" ? `${col} IS FALSE` : `${col} IS NULL`;
    return { sql: negate ? `NOT (${expr})` : expr, params: [] };
  }

  if (op === "in") {
    const values = parseInList(rawValue);
    if (values.length === 0) return { sql: negate ? "TRUE" : "FALSE", params: [] };
    const placeholders = values.map(() => `$${nextParam()}`);
    const expr = `${col} IN (${placeholders.join(", ")})`;
    return { sql: negate ? `NOT (${expr})` : expr, params: values };
  }

  if (op === "like" || op === "ilike") {
    const sqlOp = op === "like" ? "LIKE" : "ILIKE";
    const expr = `${col} ${sqlOp} $${nextParam()}`;
    return { sql: negate ? `NOT (${expr})` : expr, params: [likeToSql(rawValue)] };
  }

  if (!OPERATORS.has(op)) {
    throw new HttpError(400, `Unsupported filter operator: ${op}`);
  }

  const sqlOp: string = {
    eq: "=",
    neq: "<>",
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
    cs: "@>",
    cd: "<@",
  }[op] ?? "=";

  const expr = `${col} ${sqlOp} $${nextParam()}`;
  return { sql: negate ? `NOT (${expr})` : expr, params: [rawValue] };
}

/** Parses one `or=(a.eq.1,b.eq.2)` / `and=(...)` grouped-condition value into a joined clause. */
function buildGroupClause(joiner: "AND" | "OR", value: string, nextParam: () => number): FilterClause {
  const conds = splitTopLevel(value.startsWith("(") && value.endsWith(")") ? value.slice(1, -1) : value, ",");
  const clauses: string[] = [];
  const params: unknown[] = [];
  for (const cond of conds) {
    const trimmed = cond.trim();
    const dotIdx = trimmed.indexOf(".");
    if (dotIdx === -1) continue;
    const column = trimmed.slice(0, dotIdx);
    const opAndValue = trimmed.slice(dotIdx + 1);
    const clause = buildOpClause(column, opAndValue, nextParam);
    clauses.push(clause.sql);
    params.push(...clause.params);
  }
  return { sql: `(${clauses.join(` ${joiner} `)})`, params };
}

const NON_FILTER_KEYS = new Set(["select", "order", "limit", "offset", "range", "columns", "on_conflict", "apikey"]);

/** Builds a WHERE clause (without the `WHERE` keyword) from a PostgREST-style querystring. */
export function buildWhereClause(query: Record<string, string | string[]>, paramOffset: number): FilterClause {
  let counter = paramOffset;
  const nextParam = () => ++counter;
  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const [key, rawVal] of Object.entries(query)) {
    if (NON_FILTER_KEYS.has(key)) continue;
    const values = Array.isArray(rawVal) ? rawVal : [rawVal];
    for (const val of values) {
      if (key === "or") {
        const c = buildGroupClause("OR", val, nextParam);
        clauses.push(c.sql);
        params.push(...c.params);
      } else if (key === "and") {
        const c = buildGroupClause("AND", val, nextParam);
        clauses.push(c.sql);
        params.push(...c.params);
      } else {
        const c = buildOpClause(key, val, nextParam);
        clauses.push(c.sql);
        params.push(...c.params);
      }
    }
  }

  return { sql: clauses.length ? clauses.join(" AND ") : "TRUE", params };
}

export type OrderClause = { column: string; ascending: boolean; nullsFirst?: boolean };

export function parseOrder(order: string | undefined): OrderClause[] {
  if (!order) return [];
  return order.split(",").map((raw) => {
    const parts = raw.split(".");
    const column = parts[0];
    const ascending = !parts.includes("desc");
    const nullsFirst = parts.includes("nullsfirst") ? true : parts.includes("nullslast") ? false : undefined;
    return { column, ascending, nullsFirst };
  });
}

export function renderOrderBy(orders: OrderClause[]): string {
  if (!orders.length) return "";
  const parts = orders.map((o) => {
    let s = `${quoteIdent(o.column)} ${o.ascending ? "ASC" : "DESC"}`;
    if (o.nullsFirst === true) s += " NULLS FIRST";
    if (o.nullsFirst === false) s += " NULLS LAST";
    return s;
  });
  return `ORDER BY ${parts.join(", ")}`;
}

export { quoteIdent };
