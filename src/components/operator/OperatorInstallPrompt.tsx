import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function OperatorInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/operator" }).catch(() => undefined);
    }
  }, []);

  if (!deferred || dismissed) return null;

  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
      <Download className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
      <div className="flex-1">
        <p className="font-medium">Instalar app en este teléfono</p>
        <p className="text-xs text-muted-foreground">Acceso rápido a los lavados del día.</p>
        <Button
          type="button"
          size="sm"
          className="mt-2"
          onClick={async () => {
            await deferred.prompt();
            setDeferred(null);
          }}
        >
          Instalar
        </Button>
      </div>
      <button type="button" onClick={() => setDismissed(true)} aria-label="Cerrar">
        <X className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  );
}
