import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export type PgRole = "anon" | "authenticated" | "service_role";

export type AuthContext = {
  role: PgRole;
  claims: Record<string, unknown> | null;
};

export const anonContext: AuthContext = { role: "anon", claims: null };
export const serviceContext: AuthContext = { role: "service_role", claims: null };

/**
 * Runs `fn` with a dedicated client that has PostgREST-equivalent session GUCs set
 * (request.jwt.claims, request.jwt.claim.sub/role) and the Postgres role switched via
 * SET LOCAL ROLE, so RLS policies written against auth.uid()/auth.role() behave the
 * same as they did against hosted Supabase.
 */
export async function withAuthContext<T>(
  ctx: AuthContext,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claimsJson = JSON.stringify(ctx.claims ?? { role: ctx.role });
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [claimsJson]);
    const sub = (ctx.claims?.sub as string | undefined) ?? "";
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [sub]);
    await client.query("SELECT set_config('request.jwt.claim.role', $1, true)", [ctx.role]);
    await client.query(`SET LOCAL ROLE ${ctx.role}`);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Convenience one-off query as service_role, bypassing RLS (for internal function handlers). */
export async function serviceQuery<T extends pg.QueryResultRow = any>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return withAuthContext(serviceContext, (client) => client.query<T>(text, params as any[]));
}
