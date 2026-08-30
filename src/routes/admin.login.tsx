import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/brand/Logo";
import { db } from "@/integrations/db/client";
import { useAdminAuth } from "@/hooks/use-admin-auth";

export const Route = createFileRoute("/admin/login")({
  component: AdminLogin,
});

function AdminLogin() {
  const navigate = useNavigate();
  const auth = useAdminAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If an active admin is already signed in, send them to the dashboard.
  useEffect(() => {
    if (auth.status === "admin") navigate({ to: "/admin" });
  }, [auth.status, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: signInErr } = await db.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInErr) {
      setSubmitting(false);
      setError("No pudimos iniciar sesión. Revisá tus datos e intentá de nuevo.");
      return;
    }
    // Auth state listener (in useAdminAuth) will update; effect redirects.
    setSubmitting(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-3 text-center">
          <div className="flex justify-center">
            <Logo />
          </div>
          <CardTitle>Panel Washero</CardTitle>
          <p className="text-sm text-muted-foreground">
            Ingresá para gestionar reservas, calendario y operaciones.
          </p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={submitting}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {auth.status === "not_admin" && (
              <p className="text-xs text-destructive">
                Tu usuario no tiene permisos de administrador.
              </p>
            )}
            <Button className="w-full" type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Ingresando…
                </>
              ) : (
                "Ingresar"
              )}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              <Link to="/" className="underline underline-offset-4">
                Volver al sitio
              </Link>
            </p>
          </form>
          <details className="mt-6 rounded-md border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium">¿Primer admin?</summary>
            <p className="mt-2">
              Creá un usuario en auth.users y luego agregá su <code>user_id</code> a la tabla{" "}
              <code>admin_users</code>:
            </p>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-background p-2 text-[10px]">
{`insert into public.admin_users (user_id, email, role, active)
values ('AUTH_USER_ID_HERE', 'admin@email.com', 'owner', true);`}
            </pre>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
