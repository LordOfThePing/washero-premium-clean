import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { randomUUID } from "node:crypto";
import { serviceQuery } from "../db.js";
import { signAccessToken, verifyToken } from "../jwt.js";
import { parseJsonBody } from "../body.js";

type AuthUserRow = {
  id: string;
  email: string;
  encrypted_password: string;
  role: string;
  raw_user_meta_data: Record<string, unknown>;
  raw_app_meta_data: Record<string, unknown>;
  email_confirmed_at: string | null;
  created_at: string;
  last_sign_in_at: string | null;
};

function toSupabaseUser(row: AuthUserRow) {
  return {
    id: row.id,
    aud: "authenticated",
    role: row.role,
    email: row.email,
    email_confirmed_at: row.email_confirmed_at,
    phone: "",
    app_metadata: row.raw_app_meta_data ?? {},
    user_metadata: row.raw_user_meta_data ?? {},
    identities: [],
    created_at: row.created_at,
    updated_at: row.created_at,
    last_sign_in_at: row.last_sign_in_at,
  };
}

async function issueSession(user: AuthUserRow) {
  const sessionId = randomUUID();
  const { token, expiresIn } = await signAccessToken({
    sub: user.id,
    email: user.email,
    role: "authenticated",
    session_id: sessionId,
  });
  const refreshToken = nanoid(48);
  await serviceQuery("INSERT INTO auth.refresh_tokens (token, user_id, session_id) VALUES ($1, $2, $3)", [
    refreshToken,
    user.id,
    sessionId,
  ]);
  return {
    access_token: token,
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token: refreshToken,
    user: toSupabaseUser(user),
  };
}

function authError(reply: any, status: number, message: string, code = "invalid_credentials") {
  return reply.status(status).send({ error: code, error_description: message, msg: message, code: status });
}

export function registerAuthRoutes(app: FastifyInstance) {
  app.post("/auth/v1/token", async (req, reply) => {
    const grantType = (req.query as Record<string, string>).grant_type;

    if (grantType === "password") {
      const body = parseJsonBody<{ email?: string; password?: string }>(req) ?? {};
      const email = (body.email ?? "").trim().toLowerCase();
      const password = body.password ?? "";
      if (!email || !password) return authError(reply, 400, "Email and password are required");

      const { rows } = await serviceQuery<AuthUserRow>("SELECT * FROM auth.users WHERE lower(email) = $1", [email]);
      const user = rows[0];
      if (!user) return authError(reply, 400, "Invalid login credentials");

      const ok = await bcrypt.compare(password, user.encrypted_password);
      if (!ok) return authError(reply, 400, "Invalid login credentials");

      await serviceQuery("UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1", [user.id]);
      const session = await issueSession(user);
      return reply.status(200).send(session);
    }

    if (grantType === "refresh_token") {
      const body = parseJsonBody<{ refresh_token?: string }>(req) ?? {};
      const refreshToken = body.refresh_token;
      if (!refreshToken) return authError(reply, 400, "refresh_token is required");

      const { rows } = await serviceQuery<{ user_id: string; revoked: boolean }>(
        "SELECT user_id, revoked FROM auth.refresh_tokens WHERE token = $1",
        [refreshToken],
      );
      const row = rows[0];
      if (!row || row.revoked) return authError(reply, 400, "Invalid refresh token");

      const { rows: userRows } = await serviceQuery<AuthUserRow>("SELECT * FROM auth.users WHERE id = $1", [row.user_id]);
      const user = userRows[0];
      if (!user) return authError(reply, 400, "Invalid refresh token");

      await serviceQuery("UPDATE auth.refresh_tokens SET revoked = true WHERE token = $1", [refreshToken]);
      const session = await issueSession(user);
      return reply.status(200).send(session);
    }

    return authError(reply, 400, `Unsupported grant_type: ${grantType}`, "unsupported_grant_type");
  });

  app.get("/auth/v1/user", async (req, reply) => {
    const authHeader = req.headers["authorization"];
    const token = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return authError(reply, 401, "No authorization header", "unauthorized");

    try {
      const claims = await verifyToken(token);
      const { rows } = await serviceQuery<AuthUserRow>("SELECT * FROM auth.users WHERE id = $1", [claims.sub]);
      const user = rows[0];
      if (!user) return authError(reply, 404, "User not found", "user_not_found");
      return reply.status(200).send(toSupabaseUser(user));
    } catch {
      return authError(reply, 401, "invalid JWT", "bad_jwt");
    }
  });

  app.post("/auth/v1/logout", async (req, reply) => {
    const authHeader = req.headers["authorization"];
    const token = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (token) {
      try {
        const claims = await verifyToken(token);
        if (claims.session_id) {
          await serviceQuery("UPDATE auth.refresh_tokens SET revoked = true WHERE session_id = $1", [claims.session_id]);
        }
      } catch {
        // ignore -- logout is best-effort
      }
    }
    return reply.status(204).send();
  });

  app.get("/auth/v1/.well-known/jwks.json", async (_req, reply) => {
    // HS256 (symmetric) project: no public keys to publish. supabase-js correctly
    // falls back to GET /auth/v1/user in this case (see getClaims() in auth-js).
    return reply.status(200).send({ keys: [] });
  });
}
