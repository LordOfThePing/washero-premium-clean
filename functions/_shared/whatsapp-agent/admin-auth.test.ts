// Run with: deno test --allow-env supabase/functions/_shared/whatsapp-agent/admin-auth.test.ts
//
// Only "(1) missing JWT" is testable without a live Supabase auth session — it's the one case
// that returns before any network call at all. Scenarios (2) invalid JWT, (3) authenticated
// non-admin, (4) inactive admin, and (5) active admin all require a real Supabase project with
// real fixtures (an actual non-admin user account, an actual inactive admin_users row, an actual
// active admin with a mintable session) that don't exist in this environment — see
// manual-retry.integration.test.ts's header for the same limitation applied to the retry flow as
// a whole. Those four are NOT silently claimed to pass; they are simply not run here.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireActiveAdmin } from "./admin-auth.ts";

const unreachableAdmin = new Proxy(
  {},
  {
    get() {
      throw new Error("admin client should not be touched when there is no auth header at all");
    },
  },
) as unknown as SupabaseClient;

Deno.test(
  "(1) missing JWT: rejected immediately, no DB or auth network call attempted",
  async () => {
    const result = await requireActiveAdmin(unreachableAdmin, {
      supabaseUrl: "https://example.invalid",
      anonKey: "anon-key-not-used",
      authHeader: null,
    });
    assertEquals(result, null);
  },
);

Deno.test("(1b) empty-string JWT is also rejected immediately", async () => {
  const result = await requireActiveAdmin(unreachableAdmin, {
    supabaseUrl: "https://example.invalid",
    anonKey: "anon-key-not-used",
    authHeader: "",
  });
  assertEquals(result, null);
});
