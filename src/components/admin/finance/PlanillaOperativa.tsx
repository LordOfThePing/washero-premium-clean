import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PlanillaAssumptions, PlanillaResult } from "@/lib/finance/types";
import { fmtCurrency } from "@/lib/finance/utils";

type Props = {
  assumptions: PlanillaAssumptions;
  result: PlanillaResult;
  onChange: (next: PlanillaAssumptions) => void;
  onReset: () => void;
};

function NumInput({
  label,
  value,
  onChange,
  suffix,
  step = "1",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: string;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          step={step}
          inputMode="decimal"
          className="h-9"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
        {suffix && <span className="shrink-0 text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

export function PlanillaOperativa({ assumptions, result, onChange, onReset }: Props) {
  const set = (patch: Partial<PlanillaAssumptions>) => onChange({ ...assumptions, ...patch });

  const resultRows = [
    { label: "Vendido (base)", value: fmtCurrency(result.revenue) },
    { label: "Comisiones Mercado Pago (est.)", value: fmtCurrency(result.mpCommissions) },
    { label: "Costos variables (est.)", value: fmtCurrency(result.variableCosts) },
    { label: "Costos operador (est.)", value: fmtCurrency(result.operatorCosts) },
    { label: "Logística (est.)", value: fmtCurrency(result.logisticsCosts) },
    { label: "Pago estimado dueño camioneta", value: fmtCurrency(result.truckOwnerPayment) },
    { label: "Caja neta estimada", value: fmtCurrency(result.netCash), highlight: true },
    { label: "Caja sugerida Washero", value: fmtCurrency(result.washeroCash) },
    { label: "Resultado distribuible (est.)", value: fmtCurrency(result.distributableResult) },
  ];

  return (
    <Card className="border-dashed">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-base">Estimación operativa</CardTitle>
          <p className="text-sm text-muted-foreground">
            Simulador interno con costos estimados. El bloque “Resultado neto” usa gastos Washero
            reales del Google Form. Esto no reemplaza contabilidad legal ni facturación.
          </p>
          <p className="text-xs text-muted-foreground">
            Los supuestos se guardan solo en este navegador.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground"
          onClick={onReset}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restaurar valores iniciales
        </Button>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div className="grid gap-3 sm:grid-cols-2">
          <NumInput
            label="Costo variable por vehículo"
            value={assumptions.variableCostPerVehicle}
            onChange={(v) => set({ variableCostPerVehicle: v })}
          />
          <NumInput
            label="Comisión Mercado Pago"
            value={assumptions.mercadoPagoCommissionPct}
            onChange={(v) => set({ mercadoPagoCommissionPct: v })}
            suffix="%"
            step="0.1"
          />
          <div>
            <Label className="text-xs">Costo operador</Label>
            <Select
              value={assumptions.operatorCostMode}
              onValueChange={(v) =>
                set({ operatorCostMode: v as PlanillaAssumptions["operatorCostMode"] })
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="per_vehicle">Calcular por vehículo</SelectItem>
                <SelectItem value="per_day">Calcular por día</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {assumptions.operatorCostMode === "per_vehicle" ? (
            <NumInput
              label="Monto por vehículo"
              value={assumptions.operatorCostPerVehicle}
              onChange={(v) => set({ operatorCostPerVehicle: v })}
            />
          ) : (
            <NumInput
              label="Monto por día"
              value={assumptions.operatorCostPerDay}
              onChange={(v) => set({ operatorCostPerDay: v })}
            />
          )}
          <NumInput
            label="Combustible / logística por día"
            value={assumptions.logisticsCostPerDay}
            onChange={(v) => set({ logisticsCostPerDay: v })}
          />
          <NumInput
            label="Porcentaje dueño camioneta"
            value={assumptions.truckOwnerPct}
            onChange={(v) => set({ truckOwnerPct: v })}
            suffix="%"
            step="0.1"
          />
          <NumInput
            label="Porcentaje caja Washero"
            value={assumptions.washeroCashPct}
            onChange={(v) => set({ washeroCashPct: v })}
            suffix="%"
            step="0.1"
          />
          <NumInput
            label="Gastos fijos del período (si no hay gastos Washero sync)"
            value={assumptions.fixedCostsPeriod}
            onChange={(v) => set({ fixedCostsPeriod: v })}
          />
          <NumInput
            label="Ajuste manual (+ / −)"
            value={assumptions.manualAdjustment}
            onChange={(v) => set({ manualAdjustment: v })}
          />
        </div>

        <div className="rounded-lg border bg-muted/20 p-4">
          <p className="mb-3 text-xs text-muted-foreground">
            {result.activeDays} día{result.activeDays !== 1 ? "s" : ""} con actividad en el período
          </p>
          <ul className="space-y-2.5">
            {resultRows.map((row) => (
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
        </div>
      </CardContent>
    </Card>
  );
}
