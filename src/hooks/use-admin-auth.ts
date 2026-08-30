import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { db } from "@/integrations/db/client";

export type AdminProfile = {
  user_id: string;
  email: string;
  role: string;
  active: boolean;
};

export type AdminAuthState =
  | { status: "loading"; session: null; isAdmin: false; profile: null; rpcError: null }
  | { status: "anonymous"; session: null; isAdmin: false; profile: null; rpcError: null }
  | { status: "not_admin"; session: Session; isAdmin: false; profile: null; rpcError: string | null }
  | { status: "admin"; session: Session; isAdmin: true; profile: AdminProfile; rpcError: null };

export async function fetchMyAdminProfile(): Promise<{ profile: AdminProfile | null; error: string | null }> {
  const { data, error } = await (db as unknown as {
    rpc: (fn: string) => Promise<{ data: AdminProfile[] | AdminProfile | null; error: { message: string } | null }>;
  }).rpc("get_my_admin_profile");
  if (error) return { profile: null, error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { profile: null, error: null };
  return { profile: row as AdminProfile, error: null };
}

export function useAdminAuth(): AdminAuthState {
  const [state, setState] = useState<AdminAuthState>({
    status: "loading",
    session: null,
    isAdmin: false,
    profile: null,
    rpcError: null,
  });

  useEffect(() => {
    let active = true;

    async function checkAdmin(session: Session | null) {
      if (!session) {
        if (active) setState({ status: "anonymous", session: null, isAdmin: false, profile: null, rpcError: null });
        return;
      }
      const { profile, error } = await fetchMyAdminProfile();
      if (!active) return;
      const adminRoles = ["owner", "admin"];
      if (profile && profile.active && adminRoles.includes(profile.role)) {
        setState({ status: "admin", session, isAdmin: true, profile, rpcError: null });
      } else {
        setState({ status: "not_admin", session, isAdmin: false, profile: null, rpcError: error });
      }
    }

    const { data: sub } = db.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => checkAdmin(session), 0);
    });

    db.auth.getSession().then(({ data }) => checkAdmin(data.session));

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
