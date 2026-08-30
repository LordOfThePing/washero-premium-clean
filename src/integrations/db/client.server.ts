// Server-side db client with service role key - bypasses RLS.
// Use this for admin operations in server functions and server routes only.
// For user-authenticated queries (with RLS), use the auth middleware instead.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

function createDbAdminClient() {
  const API_URL = process.env.API_URL;
  const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY;

  if (!API_URL || !SERVICE_ROLE_KEY) {
    const missing = [
      ...(!API_URL ? ['API_URL'] : []),
      ...(!SERVICE_ROLE_KEY ? ['SERVICE_ROLE_KEY'] : []),
    ];
    const message = `Missing backend environment variable(s): ${missing.join(', ')}.`;
    console.error(`[db] ${message}`);
    throw new Error(message);
  }

  return createClient<Database>(API_URL, SERVICE_ROLE_KEY, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    }
  });
}

let _dbAdmin: ReturnType<typeof createDbAdminClient> | undefined;

// Server-side db client with service role - bypasses RLS
// SECURITY: Only use this for trusted server-side operations, never expose to client code
// Import like: import { dbAdmin } from "@/integrations/db/client.server";
export const dbAdmin = new Proxy({} as ReturnType<typeof createDbAdminClient>, {
  get(_, prop, receiver) {
    if (!_dbAdmin) _dbAdmin = createDbAdminClient();
    return Reflect.get(_dbAdmin, prop, receiver);
  },
});
