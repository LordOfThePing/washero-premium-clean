import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getFunctionRegistry } from "./registry.js";
import { config } from "../config.js";

function toWebRequest(req: FastifyRequest): Request {
  const url = `${config.publicSiteUrl}${req.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }

  const hasBody = !["GET", "HEAD"].includes(req.method);
  const body = hasBody && Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : undefined;

  return new Request(url, { method: req.method, headers, body: body as BodyInit | undefined });
}

async function dispatch(req: FastifyRequest, reply: FastifyReply) {
  const { name } = req.params as { name: string };
  const handler = getFunctionRegistry().get(name);

  if (!handler) {
    return reply.status(501).send({
      ok: false,
      error: "not_implemented",
      message: `Edge function "${name}" has no ported handler yet in backend/src/functions/deno/${name}.`,
    });
  }

  try {
    const webReq = toWebRequest(req);
    const webRes = await handler(webReq);
    const bodyText = await webRes.text();
    reply.status(webRes.status);
    webRes.headers.forEach((value, key) => {
      if (key.toLowerCase() === "content-length") return;
      reply.header(key, value);
    });
    return reply.send(bodyText);
  } catch (err) {
    console.error(`[functions] ${name} threw:`, err);
    return reply.status(500).send({ ok: false, error: "internal_error" });
  }
}

export function registerFunctionRoutes(app: FastifyInstance) {
  app.route({ method: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], url: "/functions/v1/:name", handler: dispatch });
}
