import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  computeNetSplit,
  type FinanceSettings,
  type NetSplitResult,
} from "@/lib/finance/expenses";
import { fmtCurrency } from "@/lib/finance/utils";

type Props = {
  result: NetSplitResult;
  settings: FinanceSettings;
  onSaveSettings: (next: Pick<FinanceSettings, "truck_owner_pct" | "washero_pct">) => Promise<void>;
  isSaving?: boolean;
};

export function NetSplitResultCard({ result, settings, onSaveSettings, isSaving }: Props) {
  const [truckPct, setTruckPct] = useState(Number(settings.truck_owner_pct));
  const [washeroPct, setWasheroPct] = useState(Number(settings.washero_pct));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTruckPct(Number(settings.truck_owner_pct));
    setWasheroPct(Number(settings.washero_pct));
  }, [settings.truck_owner_pct, settings.washero_pct]);

  const preview = useMemo(
    () =>
      computeNetSplit(result.grossCollected, result.washeroExpenses, {
        truck_owner_pct: truckPct,
        washero_pct: washeroPct,
      }),
    [result.grossCollected, result.washeroExpenses, truckPct, washeroPct],
  );

  const dirty =
    Math.abs(truckPct - Number(settings.truck_owner_pct)) > 0.001 ||
    Math.abs(washeroPct - Number(settings.washero_pct)) > 0.001;

  const handleTruckChange = (v: number) => {
    setTruckPct(v);
    setWasheroPct(Math.round((100 - v) * 100) / 100);
    setError(null);
  };

  const handleWasheroChange = (v: number) => {
    setWasheroPct(v);
    setTruckPct(Math.round((100 - v) * 100) / 100);
    setError(null);
  };

  const handleSave = async () => {
    if (truckPct < 0 || washeroPct < 0 || truckPct > 100 || washeroPct > 100) {
      setError("Los porcentajes deben estar entre 0 y 100.");
      return;
    }
    if (Math.abs(truckPct + washeroPct - 100) > 0.01) {
      setError("Los porcentajes deben sumar 100%.");
      return;
    }
    try {
      await onSaveSettings({ truck_owner_pct: truckPct, washero_pct: washeroPct });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    }
  };

  const rows = [
    { label: "Bruto cobrado", value: fmtCurrency(preview.grossCollected) },
    {
      label: "Gastos Washero",
      value: `−${fmtCurrency(preview.washeroExpenses)}`,
    },
    { label: "Neto", value: fmtCurrency(preview.net), highlight: true },
    {
      label: `Dueño camioneta (${preview.truckOwnerPct}%)`,
      value: fmtCurrency(preview.truckOwnerShare),
    },
    {
      label: `Caja Washero (${preview.washeroPct}%)`,
      value: fmtCurrency(preview.washeroShare),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Resultado neto</CardTitle>
        <p className="text-sm text-muted-foreground">
          Bruto cobrado menos gastos Washero, repartido con porcentaje personalizable. Las
          inversiones de socios no entran acá.
        </p>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <ul className="space-y-2.5 rounded-lg border bg-muted/20 p-4">
          {rows.map((row) => (
            <li
              key={row.label}
              className={`flex items-center justify-between gap-3 text-sm ${
                row.highlight ? "font-semibold text-primary" : ""
              }`}
            >
              <span className="text-muted-foreground">{row.label}</span>
              <span className="tabular-nums">{row.value}</span>
            </li>
          ))}
        </ul>

        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground">Porcentajes de reparto</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Dueño camioneta</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  max={100}
                  className="h-9"
                  value={Number.isFinite(truckPct) ? truckPct : 0}
                  onChange={(e) => handleTruckChange(Number(e.target.value) || 0)}
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </div>
            <div>
              <Label className="text-xs">Washero</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  max={100}
                  className="h-9"
                  value={Number.isFinite(washeroPct) ? washeroPct : 0}
                  onChange={(e) => handleWasheroChange(Number(e.target.value) || 0)}
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button size="sm" onClick={handleSave} disabled={!dirty || isSaving}>
            {isSaving ? "Guardando…" : "Guardar porcentajes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
