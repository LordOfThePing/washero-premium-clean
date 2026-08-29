import type { FastifyRequest } from "fastify";
import { config } from "./config.js";
import { verifyToken } from "./jwt.js";
import type { AuthContext, PgRole } from "./db.js";

/**
 * Mirrors PostgREST/supabase-js semantics: the `apikey` header (or `Authorization: Bearer <key>`)
 * carries the project's anon/service_role key when the client isn't logged in; once a user is
 * logged in, supabase-js instead sends the user's access token as the Bearer token, and `apikey`
 * still carries the anon key. A verifiable user JWT in Authorization always wins.
 */
export async function resolveAuthContext(req: FastifyRequest): Promise<AuthContext> {
  const authHeader = req.headers["authorization"];
  const bearer = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const apikey = (req.headers["apikey"] as string | undefined) ?? bearer ?? undefined;

  if (bearer) {
    if (bearer === config.serviceRoleKey) return { role: "service_role", claims: null };
    if (bearer === config.anonKey) return { role: "anon", claims: null };
    try {
      const claims = await verifyToken(bearer);
      const role: PgRole = claims.role === "service_role" ? "service_role" : "authenticated";
      return { role, claims: claims as unknown as Record<string, unknown> };
    } catch {
      // fall through to apikey-based resolution below
    }
  }

  if (apikey === config.serviceRoleKey) return { role: "service_role", claims: null };
  return { role: "anon", claims: null };
}
