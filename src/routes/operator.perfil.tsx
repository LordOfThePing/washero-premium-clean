import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useOperatorAuth } from "@/hooks/use-operator-auth";
import { OperatorNotifications } from "@/components/operator/OperatorNotifications";
import { OperatorPwaInstallCard } from "@/components/operator/OperatorPwaInstallCard";

export const Route = createFileRoute("/operator/perfil")({
  component: OperatorPerfilPage,
});

function OperatorPerfilPage() {
  const navigate = useNavigate();
  const auth = useOperatorAuth();
  const profile = auth.status === "operator" ? auth.profile : null;
  const userId = auth.status === "operator" ? auth.session.user.id : null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Perfil</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tu cuenta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="text-muted-foreground">Email: </span>
            {profile?.email ?? "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Rol: </span>
            {profile?.role ?? "—"}
          </p>
        </CardContent>
      </Card>

      <OperatorPwaInstallCard />
      {userId ? <OperatorNotifications userId={userId} /> : null}

      <Button
        variant="destructive"
        className="h-12 w-full"
        onClick={async () => {
          await supabase.auth.signOut();
          navigate({ to: "/operator/login" });
        }}
      >
        <LogOut className="mr-2 h-4 w-4" /> Salir
      </Button>
    </div>
  );
}
