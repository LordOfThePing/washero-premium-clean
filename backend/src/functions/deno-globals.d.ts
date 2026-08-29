// Ambient type for the Deno.serve() shim used by the ported edge functions
// (see deno-compat.ts). Only the subset actually called by those functions.
declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => unknown;
};
