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
      <div className="flex items-center gap-1">
        <Input
          type="number"
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

export function PlanillaOperativa({ assumptions, result, onChange, onReset }: Props) {
  const set = (patch: Partial<PlanillaAssumptions>) => onChange({ ...assumptions, ...patch });

  const resultRows = [
    { label: "Revenue operativo", value: fmtCurrency(result.revenue) },
    { label: "Comisiones MercadoPago estimadas", value: fmtCurrency(result.mpCommissions) },
    { label: "Costos variables estimados", value: fmtCurrency(result.variableCosts) },
    { label: "Costos operador estimados", value: fmtCurrency(result.operatorCosts) },
    { label: "Costos logística estimados", value: fmtCurrency(result.logisticsCosts) },
    { label: "Pago estimado a dueño de camioneta", value: fmtCurrency(result.truckOwnerPayment) },
    { label: "Caja neta estimada", value: fmtCurrency(result.netCash), highlight: true },
    { label: "Caja sugerida para Washero", value: fmtCurrency(result.washeroCash) },
    { label: "Resultado distribuible estimado", value: fmtCurrency(result.distributableResult) },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">Planilla operativa</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Estimación editable para operación diaria. Los supuestos se guardan en este navegador.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onReset}>
          <RotateCcw className="mr-1 h-4 w-4" /> Restaurar defaults
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
            label="Comisión MercadoPago"
            value={assumptions.mercadoPagoCommissionPct}
            onChange={(v) => set({ mercadoPagoCommissionPct: v })}
            suffix="%"
            step="0.1"
          />
          <div>
            <Label className="text-xs">Modo costo operador</Label>
            <Select
              value={assumptions.operatorCostMode}
              onValueChange={(v) =>
                set({ operatorCostMode: v as PlanillaAssumptions["operatorCostMode"] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="per_vehicle">Por vehículo</SelectItem>
                <SelectItem value="per_day">Por día</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {assumptions.operatorCostMode === "per_vehicle" ? (
            <NumInput
              label="Costo operador por vehículo"
              value={assumptions.operatorCostPerVehicle}
              onChange={(v) => set({ operatorCostPerVehicle: v })}
            />
          ) : (
            <NumInput
              label="Costo operador por día"
              value={assumptions.operatorCostPerDay}
              onChange={(v) => set({ operatorCostPerDay: v })}
            />
          )}
          <NumInput
            label="Costo combustible/logística por día"
            value={assumptions.logisticsCostPerDay}
            onChange={(v) => set({ logisticsCostPerDay: v })}
          />
          <NumInput
            label="% dueño de camioneta"
            value={assumptions.truckOwnerPct}
            onChange={(v) => set({ truckOwnerPct: v })}
            suffix="%"
            step="0.1"
          />
          <NumInput
            label="% caja Washero / reinversión"
            value={assumptions.washeroCashPct}
            onChange={(v) => set({ washeroCashPct: v })}
            suffix="%"
            step="0.1"
          />
          <NumInput
            label="Otros gastos fijos del período"
            value={assumptions.fixedCostsPeriod}
            onChange={(v) => set({ fixedCostsPeriod: v })}
          />
          <NumInput
            label="Ajuste manual (+/-)"
            value={assumptions.manualAdjustment}
            onChange={(v) => set({ manualAdjustment: v })}
          />
        </div>

        <div className="rounded-lg border bg-muted/20 p-4">
          <p className="mb-3 text-xs text-muted-foreground">
            Días con actividad en el período: {result.activeDays}
          </p>
          <ul className="space-y-2">
            {resultRows.map((row) => (
              <li
                key={row.label}
                className={`flex items-center justify-between gap-2 text-sm ${
                  row.highlight ? "font-semibold text-primary" : ""
                }`}
              >
                <span className="text-muted-foreground">{row.label}</span>
                <span>{row.value}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
