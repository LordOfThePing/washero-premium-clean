import type { FastifyRequest } from "fastify";

/** The server registers a raw-buffer content type parser (see index.ts) so that the
 * /functions/v1/* dispatcher can forward the exact original bytes to ported edge
 * function handlers. Our own JSON-speaking routes (rest/auth) parse it here instead. */
export function parseJsonBody<T = unknown>(req: FastifyRequest): T {
  const raw = req.body;
  if (raw === undefined || raw === null) return undefined as unknown as T;
  if (Buffer.isBuffer(raw)) {
    if (raw.length === 0) return undefined as unknown as T;
    return JSON.parse(raw.toString("utf8"));
  }
  return raw as T;
}
