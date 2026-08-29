import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { withAuthContext } from "../db.js";
import { resolveAuthContext } from "../request-auth.js";
import { parseJsonBody } from "../body.js";
import {
  HttpError,
  buildWhereClause,
  parseOrder,
  parseSelect,
  quoteIdent,
  renderOrderBy,
  renderSelectList,
} from "./query-builder.js";

function getQuery(req: FastifyRequest): Record<string, string | string[]> {
  return req.query as Record<string, string | string[]>;
}

function wantsSingle(req: FastifyRequest): boolean {
  const accept = req.headers["accept"];
  return typeof accept === "string" && accept.includes("vnd.pgrst.object+json");
}

function parsePrefer(req: FastifyRequest) {
  const prefer = (req.headers["prefer"] as string | undefined) ?? "";
  const parts = prefer.split(",").map((p) => p.trim());
  return {
    returnRepresentation: parts.includes("return=representation"),
    countExact: parts.some((p) => p.startsWith("count=")),
    resolution: parts.find((p) => p.startsWith("resolution="))?.split("=")[1],
  };
}

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof HttpError) {
    return reply.status(err.status).send({ message: err.message, code: String(err.status) });
  }
  const pgErr = err as { code?: string; message?: string; detail?: string };
  req_log(err);
  if (pgErr?.code === "23505") {
    return reply.status(409).send({ message: pgErr.message, code: pgErr.code, details: pgErr.detail });
  }
  return reply.status(400).send({ message: pgErr?.message ?? "unknown_error", code: pgErr?.code ?? "unknown" });
}

function req_log(err: unknown) {
  // eslint-disable-next-line no-console
  console.error("[rest]", err);
}

export function registerRestRoutes(app: FastifyInstance) {
  app.route({
    method: ["GET", "HEAD"],
    url: "/rest/v1/:table",
    handler: async (req, reply) => handleSelect(req, reply),
  });

  app.post("/rest/v1/:table", async (req, reply) => handleInsert(req, reply));
  app.patch("/rest/v1/:table", async (req, reply) => handleUpdate(req, reply));
  app.put("/rest/v1/:table", async (req, reply) => handleUpdate(req, reply, true));
  app.delete("/rest/v1/:table", async (req, reply) => handleDelete(req, reply));

  app.post("/rest/v1/rpc/:fn", async (req, reply) => handleRpc(req, reply));
}

async function handleSelect(req: FastifyRequest, reply: FastifyReply) {
  const { table } = req.params as { table: string };
  const query = getQuery(req);
  try {
    const ctx = await resolveAuthContext(req);
    const fields = parseSelect(query.select as string | undefined);
    const orders = parseOrder(query.order as string | undefined);
    const { sql: whereSql, params } = buildWhereClause(query, 0);
    const prefer = parsePrefer(req);

    const limit = query.limit ? Number(query.limit) : undefined;
    const offset = query.offset ? Number(query.offset) : 0;
    const range = req.headers["range"] as string | undefined;
    let rangeLimit: number | undefined;
    let rangeOffset = 0;
    if (range) {
      const m = range.match(/(\d+)-(\d+)/);
      if (m) {
        rangeOffset = Number(m[1]);
        rangeLimit = Number(m[2]) - Number(m[1]) + 1;
      }
    }

    const result = await withAuthContext(ctx, async (client) => {
      const selectList = await renderSelectList(fields, table, "t");
      let sql = `SELECT ${selectList} FROM ${quoteIdent(table)} t WHERE ${whereSql}`;
      const orderSql = renderOrderBy(orders);
      if (orderSql) sql += ` ${orderSql}`;
      const finalLimit = rangeLimit ?? limit;
      const finalOffset = rangeLimit !== undefined ? rangeOffset : offset;
      if (finalLimit !== undefined) sql += ` LIMIT ${Number.isFinite(finalLimit) ? finalLimit : 1000}`;
      if (finalOffset) sql += ` OFFSET ${Number.isFinite(finalOffset) ? finalOffset : 0}`;
      const rows = (await client.query(sql, params)).rows;

      let count: number | undefined;
      if (prefer.countExact || req.method === "HEAD") {
        const countRes = await client.query(`SELECT count(*)::int AS c FROM ${quoteIdent(table)} t WHERE ${whereSql}`, params);
        count = countRes.rows[0]?.c ?? 0;
      }
      return { rows, count };
    });

    if (result.count !== undefined) {
      const from = offset;
      const to = offset + result.rows.length - 1;
      reply.header("content-range", `${from}-${to < from ? from : to}/${result.count}`);
    }

    if (req.method === "HEAD") return reply.status(200).send();

    if (wantsSingle(req)) {
      if (result.rows.length !== 1) {
        return reply.status(406).send({ message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" });
      }
      return reply.status(200).send(result.rows[0]);
    }

    return reply.status(200).send(result.rows);
  } catch (err) {
    return sendError(reply, err);
  }
}

async function handleInsert(req: FastifyRequest, reply: FastifyReply) {
  const { table } = req.params as { table: string };
  try {
    const ctx = await resolveAuthContext(req);
    const prefer = parsePrefer(req);
    const body = parseJsonBody(req);
    const rowsIn = Array.isArray(body) ? body : [body];
    if (rowsIn.length === 0) return reply.status(400).send({ message: "empty body" });

    const columns = Array.from(new Set(rowsIn.flatMap((r) => Object.keys(r as object))));
    const colList = columns.map((c) => quoteIdent(c)).join(", ");

    const query = getQuery(req);
    const onConflict = query.on_conflict as string | undefined;
    const conflictCols = onConflict ? onConflict.split(",").map((c) => quoteIdent(c.trim())).join(", ") : undefined;

    const rows = await withAuthContext(ctx, async (client) => {
      const params: unknown[] = [];
      const valueTuples = rowsIn.map((row) => {
        const rec = row as Record<string, unknown>;
        const placeholders = columns.map((c) => {
          params.push(rec[c] ?? null);
          return `$${params.length}`;
        });
        return `(${placeholders.join(", ")})`;
      });

      let sql = `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES ${valueTuples.join(", ")}`;
      if (conflictCols) {
        if (prefer.resolution === "ignore-duplicates") {
          sql += ` ON CONFLICT (${conflictCols}) DO NOTHING`;
        } else {
          const updateSet = columns
            .filter((c) => !onConflict!.split(",").map((x) => x.trim()).includes(c))
            .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
            .join(", ");
          sql += ` ON CONFLICT (${conflictCols}) DO ${updateSet ? `UPDATE SET ${updateSet}` : "NOTHING"}`;
        }
      }
      sql += " RETURNING *";
      const res = await client.query(sql, params);
      return res.rows;
    });

    if (!prefer.returnRepresentation) return reply.status(201).send();
    if (wantsSingle(req)) {
      return reply.status(201).send(rows[0] ?? null);
    }
    return reply.status(201).send(rows);
  } catch (err) {
    return sendError(reply, err);
  }
}

async function handleUpdate(req: FastifyRequest, reply: FastifyReply, isPut = false) {
  const { table } = req.params as { table: string };
  try {
    const ctx = await resolveAuthContext(req);
    const prefer = parsePrefer(req);
    const query = getQuery(req);
    const { sql: whereSql, params: whereParams } = buildWhereClause(query, 0);
    const body = parseJsonBody<Record<string, unknown>>(req);
    const columns = Object.keys(body);
    if (columns.length === 0) return reply.status(400).send({ message: "empty body" });

    const rows = await withAuthContext(ctx, async (client) => {
      const params: unknown[] = [...whereParams];
      const setList = columns
        .map((c) => {
          params.push(body[c]);
          return `${quoteIdent(c)} = $${params.length}`;
        })
        .join(", ");
      const sql = `UPDATE ${quoteIdent(table)} SET ${setList} WHERE ${whereSql} RETURNING *`;
      const res = await client.query(sql, params);
      return res.rows;
    });

    if (!prefer.returnRepresentation) return reply.status(204).send();
    if (wantsSingle(req)) {
      if (rows.length !== 1) {
        return reply.status(406).send({ message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" });
      }
      return reply.status(200).send(rows[0]);
    }
    return reply.status(200).send(rows);
  } catch (err) {
    return sendError(reply, err);
  }
}

async function handleDelete(req: FastifyRequest, reply: FastifyReply) {
  const { table } = req.params as { table: string };
  try {
    const ctx = await resolveAuthContext(req);
    const prefer = parsePrefer(req);
    const query = getQuery(req);
    const { sql: whereSql, params } = buildWhereClause(query, 0);

    const rows = await withAuthContext(ctx, async (client) => {
      const sql = `DELETE FROM ${quoteIdent(table)} WHERE ${whereSql} RETURNING *`;
      const res = await client.query(sql, params);
      return res.rows;
    });

    if (!prefer.returnRepresentation) return reply.status(204).send();
    return reply.status(200).send(rows);
  } catch (err) {
    return sendError(reply, err);
  }
}

async function handleRpc(req: FastifyRequest, reply: FastifyReply) {
  const { fn } = req.params as { fn: string };
  try {
    const ctx = await resolveAuthContext(req);
    const body = parseJsonBody<Record<string, unknown>>(req) ?? {};
    const argNames = Object.keys(body);

    const rows = await withAuthContext(ctx, async (client) => {
      const params = argNames.map((k) => body[k]);
      const namedArgs = argNames.map((k, i) => `${quoteIdent(k)} := $${i + 1}`).join(", ");
      const sql = `SELECT * FROM ${quoteIdent(fn)}(${namedArgs})`;
      const res = await client.query(sql, params);
      return res.rows;
    });

    if (wantsSingle(req)) {
      return reply.status(200).send(rows[0] ?? null);
    }
    // Supabase RPC returns a scalar directly when the function returns a single non-table
    // value with one column; approximate that by unwrapping a one-column, one-row result
    // only when the function clearly isn't returning a row-set of a named composite type.
    if (rows.length === 1 && Object.keys(rows[0]).length === 1) {
      const onlyKey = Object.keys(rows[0])[0];
      if (onlyKey === fn || onlyKey === "result" || onlyKey.startsWith(fn)) {
        return reply.status(200).send(rows[0][onlyKey]);
      }
    }
    return reply.status(200).send(rows);
  } catch (err) {
    return sendError(reply, err);
  }
}
