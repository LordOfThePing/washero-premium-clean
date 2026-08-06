import { RefreshCw, Download, FileSpreadsheet, TrendingUp, CloudDownload } from "lucide-react";
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
import { fmtDate, PERIOD_LABELS } from "@/lib/finance/utils";

type Props = {
  period: PeriodPreset;
  periodFrom: string;
  periodTo: string;
  customFrom: string;
  customTo: string;
  onPeriodChange: (v: PeriodPreset) => void;
  onCustomFromChange: (v: string) => void;
  onCustomToChange: (v: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onSyncExpenses?: () => void;
  isSyncingExpenses?: boolean;
  onExportDailyCash: () => void;
  onExportBookings: () => void;
  onExportPlanilla: () => void;
  exportDisabled: boolean;
};

export function FinanceHeader({
  period,
  periodFrom,
  periodTo,
  customFrom,
  customTo,
  onPeriodChange,
  onCustomFromChange,
  onCustomToChange,
  onRefresh,
  isRefreshing,
  onSyncExpenses,
  isSyncingExpenses,
  onExportDailyCash,
  onExportBookings,
  onExportPlanilla,
  exportDisabled,
}: Props) {
  const periodLabel =
    periodFrom === periodTo ? fmtDate(periodFrom) : `${fmtDate(periodFrom)} – ${fmtDate(periodTo)}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <TrendingUp className="h-5 w-5 shrink-0" /> Finanzas
          </h1>
          <p className="text-sm text-muted-foreground">
            Caja diaria, cobros, gastos e inversiones del negocio.
          </p>
          <p className="mt-1 text-xs font-medium text-muted-foreground">
            Período: {periodLabel}
            {period !== "custom" && <span className="font-normal"> · {PERIOD_LABELS[period]}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`mr-1.5 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
          {onSyncExpenses && (
            <Button
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={onSyncExpenses}
              disabled={isSyncingExpenses}
              title="Traer gastos nuevos desde el Google Form / Sheet"
            >
              <CloudDownload
                className={`mr-1.5 h-4 w-4 ${isSyncingExpenses ? "animate-pulse" : ""}`}
              />
              {isSyncingExpenses ? "Sincronizando…" : "Sincronizar gastos"}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-none"
            onClick={onExportDailyCash}
            disabled={exportDisabled}
            title="Descargar caja diaria en CSV"
          >
            <Download className="mr-1.5 h-4 w-4 shrink-0" />
            <span className="truncate">Caja CSV</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-none"
            onClick={onExportBookings}
            disabled={exportDisabled}
            title="Descargar listado de reservas en CSV"
          >
            <Download className="mr-1.5 h-4 w-4 shrink-0" />
            <span className="truncate">Reservas CSV</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            onClick={onExportPlanilla}
            disabled={exportDisabled}
            title="Descargar planilla compatible con Excel"
          >
            <FileSpreadsheet className="mr-1.5 h-4 w-4 shrink-0" />
            <span className="truncate">Exportar planilla compatible Excel</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <div className="w-full min-w-0 sm:w-auto sm:min-w-[180px]">
          <Label className="text-xs">Ver período</Label>
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
            <div className="w-full sm:w-auto">
              <Label className="text-xs">Desde</Label>
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => onCustomFromChange(e.target.value)}
              />
            </div>
            <div className="w-full sm:w-auto">
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
