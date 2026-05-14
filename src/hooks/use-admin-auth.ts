import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AdminAuthState =
  | { status: "loading"; session: null; isAdmin: false }
  | { status: "anonymous"; session: null; isAdmin: false }
  | { status: "not_admin"; session: Session; isAdmin: false }
  | { status: "admin"; session: Session; isAdmin: true };

export function useAdminAuth(): AdminAuthState {
  const [state, setState] = useState<AdminAuthState>({
    status: "loading",
    session: null,
    isAdmin: false,
  });

  useEffect(() => {
    let active = true;

    async function checkAdmin(session: Session | null) {
      if (!session) {
        if (active) setState({ status: "anonymous", session: null, isAdmin: false });
        return;
      }
      const { data, error } = await supabase
        .from("admin_users")
        .select("id")
        .eq("user_id", session.user.id)
        .eq("active", true)
        .limit(1)
        .maybeSingle();
      if (!active) return;
      if (error || !data) {
        setState({ status: "not_admin", session, isAdmin: false });
      } else {
        setState({ status: "admin", session, isAdmin: true });
      }
    }

    // Set listener BEFORE getSession
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      // Defer DB call to avoid deadlocking the auth callback
      setTimeout(() => checkAdmin(session), 0);
    });

    supabase.auth.getSession().then(({ data }) => checkAdmin(data.session));

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
