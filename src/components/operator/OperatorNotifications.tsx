import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, ChevronDown, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { isIosDevice, isStandalonePwa } from "@/lib/operator-pwa";
import {
  collectPushDiagnostics,
  fetchUserPushSubscriptions,
  getWebPushPublicKey,
  isWebPushSupported,
  sendOperatorTestPush,
  subscribeOperatorPush,
  type PushDiagnostics,
} from "@/lib/web-push";
import { cn } from "@/lib/utils";

type NotificationStatus =
  | "unsupported"
  | "blocked"
  | "inactive"
  | "active"
  | "missing_key";

type LastTestResult =
  | { state: "success"; sent_count: number }
  | { state: "skipped"; reason: string }
  | { state: "error"; message: string }
  | null;

const STATUS_LABEL: Record<NotificationStatus, string> = {
  unsupported: "Push no soportadas",
  blocked: "Push bloqueadas",
  inactive: "Push desactivadas",
  active: "Push activadas",
  missing_key: "Configuración pendiente",
};

type Props = {
  userId: string;
};

function yesNo(value: boolean) {
  return value ? "sí" : "no";
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function OperatorNotifications({ userId }: Props) {
  const qc = useQueryClient();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "default",
  );
  const [activating, setActivating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [lastTest, setLastTest] = useState<LastTestResult>(null);
  const ios = isIosDevice();
  const standalone = isStandalonePwa();
  const publicKey = getWebPushPublicKey();

  useEffect(() => {
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
  }, []);

  const subsQuery = useQuery({
    queryKey: ["operator", "push-subscriptions", userId],
    queryFn: () => fetchUserPushSubscriptions(userId),
    enabled: !!userId,
  });

  const diagnosticsQuery = useQuery({
    queryKey: ["operator", "push-diagnostics", userId],
    queryFn: () => collectPushDiagnostics(userId),
    enabled: !!userId && diagOpen,
  });

  const status: NotificationStatus = useMemo(() => {
    if (!publicKey) return "missing_key";
    if (!isWebPushSupported()) return "unsupported";
    if (permission === "denied") return "blocked";
    if ((subsQuery.data?.length ?? 0) > 0 && permission === "granted") return "active";
    return "inactive";
  }, [permission, publicKey, subsQuery.data]);

  const refreshDiagnostics = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["operator", "push-diagnostics", userId] });
    await qc.invalidateQueries({ queryKey: ["operator", "push-subscriptions", userId] });
  }, [qc, userId]);

  const onActivate = useCallback(async () => {
    if (!publicKey) {
      toast.error("Falta VITE_WEB_PUSH_PUBLIC_KEY en el entorno.");
      return;
    }
    setActivating(true);
    try {
      await subscribeOperatorPush(userId);
      setPermission(Notification.permission);
      await refreshDiagnostics();
      toast.success("Notificaciones activadas en este dispositivo.");
    } catch (e) {
      const code = e instanceof Error ? e.message : "unknown";
      if (code === "permission_denied") {
        toast.error("Permiso bloqueado. Habilitalo en ajustes del navegador.");
      } else if (code === "permission_denied_db") {
        toast.error("No pudimos guardar la suscripción. Verificá que tu usuario sea operador.");
      } else if (code === "not_supported") {
        toast.error("Este navegador no soporta notificaciones push.");
      } else if (code === "subscription_save_failed") {
        toast.error("No pudimos guardar la suscripción en el servidor.");
      } else {
        toast.error("No pudimos activar las notificaciones.");
      }
    } finally {
      setActivating(false);
    }
  }, [publicKey, refreshDiagnostics, userId]);

  const onTest = useCallback(async () => {
    setTesting(true);
    try {
      const result = await sendOperatorTestPush();
      if (result.sent_count > 0) {
        setLastTest({ state: "success", sent_count: result.sent_count });
        toast.success("Notificación de prueba enviada.");
      } else if (result.skipped_reason === "no_subscriptions") {
        setLastTest({ state: "skipped", reason: "no_subscriptions" });
        toast.warning("No hay suscripción guardada. Activá notificaciones primero.");
      } else if ((result.failed_count ?? 0) > 0) {
        setLastTest({ state: "error", message: "delivery_failed" });
        toast.warning("La suscripción existe pero el envío falló. Volvé a activar notificaciones.");
      } else {
        setLastTest({ state: "skipped", reason: result.skipped_reason ?? "unknown" });
        toast.message("No se pudo entregar la prueba.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "push_failed";
      setLastTest({ state: "error", message: msg });
      if (msg === "missing_vapid_config") {
        toast.error("Faltan claves VAPID en el servidor (WEB_PUSH_VAPID_*).");
      } else if (msg === "forbidden") {
        toast.error("No tenés permiso para enviar la prueba.");
      } else {
        toast.error("No se pudo enviar la notificación de prueba.");
      }
    } finally {
      setTesting(false);
    }
  }, []);

  const diag: PushDiagnostics | undefined = diagnosticsQuery.data;

  const lastTestLabel = (() => {
    if (!lastTest) return "—";
    if (lastTest.state === "success") return `éxito (${lastTest.sent_count})`;
    if (lastTest.state === "skipped") {
      if (lastTest.reason === "no_subscriptions") return "omitida (sin suscripción)";
      return `omitida (${lastTest.reason})`;
    }
    if (lastTest.message === "missing_vapid_config") return "error (config VAPID)";
    return `error (${lastTest.message})`;
  })();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {status === "active" ? (
            <Bell className="h-4 w-4 text-primary" />
          ) : (
            <BellOff className="h-4 w-4 text-muted-foreground" />
          )}
          Notificaciones
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          <span className="text-muted-foreground">Estado: </span>
          <span className="font-medium">{STATUS_LABEL[status]}</span>
        </p>

        {status === "missing_key" ? (
          <p className="rounded-md border border-amber-300/50 bg-amber-50 p-2 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
            Falta <code className="text-[11px]">VITE_WEB_PUSH_PUBLIC_KEY</code> en el entorno.
            Configurala en producción para habilitar push.
          </p>
        ) : null}

        {ios && !standalone ? (
          <p className="text-xs text-muted-foreground">
            En iPhone, primero agregá Washero a la pantalla de inicio. Luego abrí la app instalada
            y activá notificaciones.
          </p>
        ) : null}

        <Button
          type="button"
          className="w-full"
          disabled={activating || status === "unsupported" || status === "blocked"}
          onClick={onActivate}
        >
          {activating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Activar notificaciones
        </Button>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={testing || status === "missing_key" || status === "unsupported"}
          onClick={onTest}
        >
          {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          <Send className="mr-2 h-4 w-4" />
          Enviar notificación de prueba
        </Button>

        <Collapsible open={diagOpen} onOpenChange={setDiagOpen}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-8 w-full justify-between px-2">
              <span className="text-xs text-muted-foreground">Diagnóstico</span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", diagOpen && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2 rounded-md border bg-muted/20 p-3">
            {diagnosticsQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Cargando diagnóstico…</p>
            ) : diag ? (
              <>
                <DiagnosticRow label="Service worker API" value={yesNo(diag.serviceWorkerApi)} />
                <DiagnosticRow label="PushManager API" value={yesNo(diag.pushManagerApi)} />
                <DiagnosticRow label="Permiso" value={diag.notificationPermission} />
                <DiagnosticRow label="SW registrado" value={yesNo(diag.serviceWorkerRegistered)} />
                <DiagnosticRow label="Suscripción en navegador" value={yesNo(diag.browserSubscription)} />
                <DiagnosticRow label="Suscripción en Supabase" value={yesNo(diag.supabaseSubscription)} />
                <DiagnosticRow label="Clave pública VAPID" value={yesNo(diag.publicKeyConfigured)} />
                <DiagnosticRow label="Última prueba" value={lastTestLabel} />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No se pudo cargar el diagnóstico.</p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full"
              onClick={() => refreshDiagnostics()}
            >
              Actualizar diagnóstico
            </Button>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
