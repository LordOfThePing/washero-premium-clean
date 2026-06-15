import { AlertTriangle, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FinanceAlert } from "@/lib/finance/types";

type Props = { alerts: FinanceAlert[] };

export function FinanceAlerts({ alerts }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Alertas operativas</CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin alertas relevantes en este momento.</p>
        ) : (
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li
                key={a.id}
                className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                  a.severity === "warning"
                    ? "border-amber-500/30 bg-amber-500/5"
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
