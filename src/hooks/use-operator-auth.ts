import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { db } from "@/integrations/db/client";
import { fetchMyOperatorProfile, type OperatorProfile } from "@/lib/operator";

export type OperatorAuthState =
  | { status: "loading"; session: null; profile: null }
  | { status: "anonymous"; session: null; profile: null }
  | { status: "unauthorized"; session: Session; profile: null; rpcError: string | null }
  | { status: "operator"; session: Session; profile: OperatorProfile };

export function useOperatorAuth(): OperatorAuthState {
  const [state, setState] = useState<OperatorAuthState>({
    status: "loading",
    session: null,
    profile: null,
  });

  useEffect(() => {
    let active = true;

    async function check(session: Session | null) {
      if (!session) {
        if (active) setState({ status: "anonymous", session: null, profile: null });
        return;
      }
      const { profile, error } = await fetchMyOperatorProfile();
      if (!active) return;
      if (profile?.active) {
        setState({ status: "operator", session, profile });
      } else {
        setState({ status: "unauthorized", session, profile: null, rpcError: error });
      }
    }

    const { data: sub } = db.auth.onAuthStateChange((_e, session) => {
      setTimeout(() => check(session), 0);
    });

    db.auth.getSession().then(({ data }) => check(data.session));

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
