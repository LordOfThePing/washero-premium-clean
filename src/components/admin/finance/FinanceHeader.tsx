import { RefreshCw, Download, FileSpreadsheet, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PeriodPreset } from "@/lib/finance/types";
import { PERIOD_LABELS } from "@/lib/finance/utils";

type Props = {
  period: PeriodPreset;
  customFrom: string;
  customTo: string;
  onPeriodChange: (v: PeriodPreset) => void;
  onCustomFromChange: (v: string) => void;
  onCustomToChange: (v: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onExportDailyCash: () => void;
  onExportBookings: () => void;
  onExportPlanilla: () => void;
  exportDisabled: boolean;
};

export function FinanceHeader({
  period,
  customFrom,
  customTo,
  onPeriodChange,
  onCustomFromChange,
  onCustomToChange,
  onRefresh,
  isRefreshing,
  onExportDailyCash,
  onExportBookings,
  onExportPlanilla,
  exportDisabled,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <TrendingUp className="h-5 w-5" /> Finanzas
          </h1>
          <p className="text-sm text-muted-foreground">
            Caja, cobros, pendientes y proyección operativa.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={isRefreshing}>
            <RefreshCw className={`mr-1 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Refrescar
          </Button>
          <Button variant="outline" size="sm" onClick={onExportDailyCash} disabled={exportDisabled}>
            <Download className="mr-1 h-4 w-4" /> Caja CSV
          </Button>
          <Button variant="outline" size="sm" onClick={onExportBookings} disabled={exportDisabled}>
            <Download className="mr-1 h-4 w-4" /> Reservas CSV
          </Button>
          <Button variant="outline" size="sm" onClick={onExportPlanilla} disabled={exportDisabled}>
            <FileSpreadsheet className="mr-1 h-4 w-4" /> Planilla .xls
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <div className="min-w-[180px]">
          <Label className="text-xs">Período</Label>
          <Select value={period} onValueChange={(v) => onPeriodChange(v as PeriodPreset)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIOD_LABELS) as PeriodPreset[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {PERIOD_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {period === "custom" && (
          <>
            <div>
              <Label className="text-xs">Desde</Label>
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => onCustomFromChange(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Hasta</Label>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => onCustomToChange(e.target.value)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
