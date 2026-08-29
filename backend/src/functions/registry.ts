import "./deno-compat.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { takeCapturedHandler } from "./deno-compat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const denoDir = path.join(__dirname, "deno");

export type DenoHandler = (req: Request) => Response | Promise<Response>;

const registry = new Map<string, DenoHandler>();

/** Every subdirectory of functions/deno is one re-homed edge function; its Deno.serve
 * handler is captured at import time and registered under the directory name, which is
 * exactly the name the frontend passes to supabase.functions.invoke(name). */
export async function loadFunctionRegistry(): Promise<Map<string, DenoHandler>> {
  const names = fs
    .readdirSync(denoDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "_shared")
    .map((d) => d.name);

  for (const name of names) {
    const indexPath = path.join(denoDir, name, "index.ts");
    if (!fs.existsSync(indexPath)) continue;
    try {
      await import(`./deno/${name}/index.ts`);
      const handler = takeCapturedHandler();
      if (handler) {
        registry.set(name, handler);
      } else {
        console.warn(`[functions] ${name}: module did not call Deno.serve(); no handler captured`);
      }
    } catch (err) {
      console.error(`[functions] failed to load ${name}:`, err);
    }
  }

  console.log(`[functions] loaded ${registry.size}/${names.length} edge function handler(s)`);
  return registry;
}

export function getFunctionRegistry() {
  return registry;
}
