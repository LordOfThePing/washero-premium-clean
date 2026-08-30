import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { config } from "./config.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerRestRoutes } from "./rest/routes.js";
import { registerStorageRoutes } from "./storage/routes.js";
import { registerFunctionRoutes } from "./functions/routes.js";
import { loadFunctionRegistry } from "./functions/registry.js";

// The ported backend functions (backend/src/functions/deno/**) read API_URL /
// SERVICE_ROLE_KEY / ANON_KEY at import time and use supabase-js (the npm client
// library, which still speaks this same REST/Auth/Storage protocol) against them --
// pointing those at this same server means they transparently talk to our own
// implementation instead of any external service.
process.env.API_URL ??= `http://127.0.0.1:${config.port}`;
process.env.SERVICE_ROLE_KEY ??= config.serviceRoleKey;
process.env.ANON_KEY ??= config.anonKey;

const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });

async function main() {
  await app.register(cors, { origin: true });

  // Raw-buffer body parsing everywhere: our own REST/Auth handlers JSON.parse it
  // themselves (see body.ts), and the /functions/v1 dispatcher forwards the exact
  // original bytes to ported edge function handlers. Fastify's built-in
  // application/json and text/plain parsers would otherwise take priority over a
  // wildcard parser (they're exact content-type matches), so drop those first --
  // multipart/form-data keeps working via @fastify/multipart's own parser,
  // registered afterwards below.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, payload, done) => {
    done(null, payload as Buffer);
  });

  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  registerAuthRoutes(app);
  registerRestRoutes(app);
  registerStorageRoutes(app);
  registerFunctionRoutes(app);

  app.get("/", async () => ({ ok: true, service: "washero-backend" }));

  await loadFunctionRegistry();

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
