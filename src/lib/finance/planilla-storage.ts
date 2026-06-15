import type { PlanillaAssumptions } from "./types";

export const PLANILLA_STORAGE_KEY = "washero-finance-planilla-v1";

export const DEFAULT_PLANILLA: PlanillaAssumptions = {
  variableCostPerVehicle: 500,
  mercadoPagoCommissionPct: 3.5,
  operatorCostPerVehicle: 800,
  operatorCostPerDay: 3500,
  operatorCostMode: "per_vehicle",
  logisticsCostPerDay: 1500,
  truckOwnerPct: 40,
  washeroCashPct: 60,
  fixedCostsPeriod: 0,
  manualAdjustment: 0,
};

export function loadPlanillaAssumptions(): PlanillaAssumptions {
  if (typeof window === "undefined") return { ...DEFAULT_PLANILLA };
  try {
    const raw = localStorage.getItem(PLANILLA_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PLANILLA };
    const parsed = JSON.parse(raw) as Partial<PlanillaAssumptions>;
    return { ...DEFAULT_PLANILLA, ...parsed };
  } catch {
    return { ...DEFAULT_PLANILLA };
  }
}

export function savePlanillaAssumptions(value: PlanillaAssumptions) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PLANILLA_STORAGE_KEY, JSON.stringify(value));
}

export function resetPlanillaAssumptions(): PlanillaAssumptions {
  if (typeof window !== "undefined") {
    localStorage.removeItem(PLANILLA_STORAGE_KEY);
  }
  return { ...DEFAULT_PLANILLA };
}
