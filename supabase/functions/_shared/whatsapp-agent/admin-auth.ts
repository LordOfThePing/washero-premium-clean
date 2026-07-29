// Shared "real JWT, cross-checked against admin_users.active" auth check, extracted so it's
// testable without a live HTTP server (production-hardening audit — auth requirements for the
// manual-retry endpoint). See admin-auth.test.ts for the parts of this that don't require a live
// Supabase auth session (missing JWT); the rest (invalid JWT / non-admin / inactive admin / active
// admin) fundamentally need a real Supabase project with real user fixtures to test — see that
// test file's header for exactly what's missing here and why.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type AdminIdentity = { adminId: string };

export async function requireActiveAdmin(
  admin: SupabaseClient,
  opts: { supabaseUrl: string; anonKey: string; authHeader: string | null },
): Promise<AdminIdentity | null> {
  if (!opts.authHeader) return null;

  const userClient = createClient(opts.supabaseUrl, opts.anonKey, {
    global: { headers: { Authorization: opts.authHeader } },
    auth: { persistSession: false },
  });
  const { data, error: authError } = await userClient.auth.getUser();
  if (authError || !data.user) return null;

  const { data: row } = await admin
    .from("admin_users")
    .select("id, active")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (!row?.active) return null;

  return { adminId: row.id };
}
