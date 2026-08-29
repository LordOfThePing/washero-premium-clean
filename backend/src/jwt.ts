import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { config } from "./config.js";

const secret = new TextEncoder().encode(config.jwtSecret);

export type AppClaims = JWTPayload & {
  sub: string;
  email?: string;
  role: "anon" | "authenticated" | "service_role";
  aud?: string;
  session_id?: string;
};

export async function signAccessToken(claims: Omit<AppClaims, "iat" | "exp">): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = Number(config.jwtExpiresIn) || 3600;
  const token = await new SignJWT({ ...claims, aud: claims.aud ?? "authenticated" } as JWTPayload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresIn)
    .sign(secret);
  return { token, expiresIn };
}

export async function verifyToken(token: string): Promise<AppClaims> {
  const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
  return payload as AppClaims;
}
