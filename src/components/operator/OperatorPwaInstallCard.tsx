import { useEffect, useState } from "react";
import { Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isIosDevice, isStandalonePwa } from "@/lib/operator-pwa";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function OperatorPwaInstallCard() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const ios = isIosDevice();

  useEffect(() => {
    setStandalone(isStandalonePwa());

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (standalone) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Download className="h-4 w-4 text-primary" />
          Instalar app Washero
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Accedé más rápido a tus lavados del día desde el ícono del teléfono.
        </p>

        {deferred ? (
          <Button
            type="button"
            className="w-full"
            onClick={async () => {
              await deferred.prompt();
              const choice = await deferred.userChoice;
              if (choice.outcome === "accepted") setDeferred(null);
            }}
          >
            Instalar
          </Button>
        ) : null}

        {ios || (!deferred && !ios) ? (
          <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="mb-1 flex items-center gap-1 font-medium text-foreground">
              <Share className="h-3.5 w-3.5" /> iPhone / iPad
            </p>
            <p>Tocá Compartir → Agregar a pantalla de inicio.</p>
            <p className="mt-2">
              En iPhone, primero agregá Washero a la pantalla de inicio. Luego abrí la app instalada
              y activá notificaciones.
            </p>
          </div>
        ) : null}

        {!ios && !deferred ? (
          <p className="text-xs text-muted-foreground">
            En Android, usá el menú del navegador (⋮) y elegí &quot;Instalar app&quot; o
            &quot;Agregar a pantalla de inicio&quot;.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
