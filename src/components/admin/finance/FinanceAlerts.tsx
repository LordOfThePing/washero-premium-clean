import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FinanceAlert } from "@/lib/finance/types";

type Props = { alerts: FinanceAlert[] };

export function FinanceAlerts({ alerts }: Props) {
  const warnings = alerts.filter((a) => a.severity === "warning");
  const infos = alerts.filter((a) => a.severity === "info");
  const sorted = [...warnings, ...infos];

  return (
    <Card className={warnings.length > 0 ? "border-amber-500/40 bg-amber-500/[0.03]" : undefined}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">Requiere atención</CardTitle>
          {warnings.length > 0 && (
            <Badge
              variant="secondary"
              className="bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200"
            >
              {warnings.length} urgente{warnings.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Transferencias, cobros pendientes e inconsistencias que conviene revisar hoy.
        </p>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2.5 text-sm text-green-800 dark:text-green-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Todo en orden por ahora. No hay alertas operativas.</span>
          </div>
        ) : (
          <ul className="space-y-2">
            {sorted.map((a) => (
              <li
                key={a.id}
                className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm ${
                  a.severity === "warning"
                    ? "border-amber-500/40 bg-amber-500/10"
                    : "border-border bg-muted/30"
                }`}
              >
                {a.severity === "warning" ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                ) : (
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span>{a.message}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
