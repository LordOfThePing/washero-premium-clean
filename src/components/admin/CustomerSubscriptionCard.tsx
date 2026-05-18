import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CreditCard, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  countUsagesForPeriod,
  fetchActiveSubscriptionForCustomer,
  formatARS,
  formatSubDate,
  remainingWashes,
  subscriptionStatusLabels,
} from "@/lib/subscriptions";

export function CustomerSubscriptionCard({ customerId }: { customerId: string }) {
  const sub = useQuery({
    queryKey: ["admin", "customer", customerId, "subscription"],
    queryFn: async () => {
      const row = await fetchActiveSubscriptionForCustomer(customerId);
      if (!row) return null;
      const plan = row.plan as {
        id: string;
        name: string;
        washes_per_month: number;
        monthly_price: number;
        active: boolean;
      } | null;
      if (!plan) return null;
      const used = await countUsagesForPeriod(
        row.id,
        row.current_period_start,
        row.current_period_end,
      );
      return { ...row, plan, used };
    },
  });

  if (sub.isLoading) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando suscripción…
        </CardContent>
      </Card>
    );
  }

  if (!sub.data) return null;

  const left = remainingWashes(sub.data.plan.washes_per_month, sub.data.used);

  return (
    <Card className="border-violet-300/50 bg-violet-50/40 dark:bg-violet-950/20">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="h-4 w-4" /> Suscripción activa
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="font-medium">{sub.data.plan.name}</p>
        <p className="text-muted-foreground">
          {formatARS(sub.data.plan.monthly_price)}/mes ·{" "}
          <Badge variant="secondary">
            {subscriptionStatusLabels[sub.data.status as keyof typeof subscriptionStatusLabels] ??
              sub.data.status}
          </Badge>
        </p>
        <p>
          Período: {formatSubDate(sub.data.current_period_start)} —{" "}
          {formatSubDate(sub.data.current_period_end)}
        </p>
        <p>
          Lavados: {sub.data.used}/{sub.data.plan.washes_per_month} usados ·{" "}
          <span className="font-medium">{left} restantes</span>
        </p>
        <Button asChild variant="outline" size="sm" className="mt-1">
          <Link to="/admin/suscripciones">Gestionar en Suscripciones</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
