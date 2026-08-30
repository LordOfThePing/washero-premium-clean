/**
 * Minimal Deno-runtime shim so the functions ported verbatim from
 * functions/**\/index.ts (Deno.serve handlers using supabase-js against
 * API_URL/SERVICE_ROLE_KEY) run unmodified under Node. Each ported
 * module still calls `Deno.serve(handler)` at import time -- we just capture the
 * handler instead of actually starting a server, then dispatch fetch-style
 * Request/Response objects to it ourselves from Fastify routes.
 */
let capturedHandler: ((req: Request) => Response | Promise<Response>) | null = null;

(globalThis as any).Deno = {
  serve(handler: (req: Request) => Response | Promise<Response>) {
    capturedHandler = handler;
    return { finished: Promise.resolve(), shutdown: async () => {} };
  },
};

export function takeCapturedHandler(): ((req: Request) => Response | Promise<Response>) | null {
  const h = capturedHandler;
  capturedHandler = null;
  return h;
}
