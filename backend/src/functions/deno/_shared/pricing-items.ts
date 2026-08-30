// @ts-nocheck -- ported verbatim from functions/; not our source of truth for types
// Shared pricing_items lookups for website, admin, and WhatsApp booking flows.
import type { SupabaseClient } from "@supabase/supabase-js";

function foldText(v: unknown) {
  return String(v ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function repairUtf8Mojibake(s: string): string {
  const raw = String(s ?? "");
  if (!raw || !/[\u00C3\u00C2\u00E2][\u0080-\u00BF]/.test(raw)) return raw;
  try {
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (decoded && !decoded.includes("\uFFFD")) return decoded;
  } catch {
    /* keep original */
  }
  return raw;
}

export type PricingExtraLine = { code: string; name: string; amount: number };

export type BookingQuote = {
  service_name: string;
  service_base_price: number;
  vehicle_code: string;
  vehicle_name: string;
  vehicle_surcharge: number;
  extras_total: number;
  total_amount: number;
  selected_extras: PricingExtraLine[];
  quote_summary: string;
};

const NONE_EXTRAS = new Set([
  "ninguno",
  "no",
  "sin extras",
  "sin extra",
  "nada",
  "ninguna",
  "none",
  "1",
]);

/** Free-text → pricing_items extra code (longer aliases matched first). */
const BOTMAKER_EXTRA_ALIASES: Array<{ code: string; aliases: string[] }> = [
  {
    code: "pelo_mascotas",
    aliases: ["2", "pelo mascota", "pelo de mascotas", "mascotas", "pelos", "pelo"],
  },
  {
    code: "barro_auto_muy_sucio",
    aliases: ["3", "barro", "barro intenso", "auto muy sucio", "muy sucio", "sucio"],
  },
  {
    code: "detallado_interior_profundo",
    aliases: [
      "4",
      "detallado interior",
      "interior profundo",
      "interior muy sucio",
      "interior",
    ],
  },
  {
    code: "encerrado_rapido",
    aliases: [
      "5",
      "encerado",
      "encerado rapido",
      "encerado rápido",
      "encerrado",
      "encerrado rapido",
      "encerrado rápido",
    ],
  },
  {
    code: "eliminacion_olores",
    aliases: [
      "6",
      "olor",
      "olores",
      "eliminacion olores",
      "eliminación olores",
      "eliminacion de olores",
      "eliminación de olores",
    ],
  },
];

const BOTMAKER_EXTRA_ALIAS_ENTRIES = BOTMAKER_EXTRA_ALIASES.flatMap(({ code, aliases }) =>
  aliases.map((alias) => ({
    code,
    folded: foldText(repairUtf8Mojibake(alias)),
  })),
).sort((a, b) => b.folded.length - a.folded.length);

export function formatPriceARS(value: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

/** Map free-text vehicle input to pricing_items vehicle_surcharge code. */
export function normalizeVehiclePricingCode(raw: string | null | undefined): string {
  const t = foldText(repairUtf8Mojibake(String(raw ?? "").trim()));
  if (!t) return "auto";
  if (t === "suv" || t.includes("crossover") || t.includes("camioneta suv")) return "suv";
  if (
    t.includes("pickup") ||
    t.includes("pick up") ||
    t.includes("pick-up") ||
    t === "van" ||
    t.includes("utilitario") ||
    (t.includes("camioneta") && !t.includes("suv"))
  ) {
    return "pickup";
  }
  if (t === "auto" || t.includes("auto chico") || t.includes("chico")) return "auto";
  if (t === "suv") return "suv";
  return "auto";
}

/** Display vehicle_type for bookings table (matches VEHICLE_TYPES in booking-core). */
export function vehicleDisplayTypeFromPricingCode(code: string): string {
  const c = foldText(code);
  if (c === "suv") return "SUV";
  if (c === "pickup" || c.includes("pick")) return "Pick-up";
  return "Auto";
}

export function parseFreeTextExtrasInput(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((x) => parseFreeTextExtrasInput(x));
  }
  const text = String(raw).trim();
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      return parseFreeTextExtrasInput(JSON.parse(text));
    } catch {
      /* fall through */
    }
  }
  return text.split(/[,;/|]+/).map((s) => s.trim()).filter(Boolean);
}

function isNoneExtraToken(token: string): boolean {
  const t = foldText(repairUtf8Mojibake(token));
  return !t || NONE_EXTRAS.has(t);
}

function extraCodeFromToken(token: string): string | null {
  const t = foldText(repairUtf8Mojibake(token));
  if (!t || NONE_EXTRAS.has(t)) return null;

  for (const { code, folded } of BOTMAKER_EXTRA_ALIAS_ENTRIES) {
    if (t === folded) return code;
  }
  for (const { code, folded } of BOTMAKER_EXTRA_ALIAS_ENTRIES) {
    if (!folded) continue;
    if (folded.length >= 3 && t.includes(folded)) return code;
    if (t.length >= 3 && folded.includes(t)) return code;
  }
  return null;
}

type ActiveExtraRow = { code: string; name: string };

async function loadActiveExtraRows(admin: SupabaseClient): Promise<ActiveExtraRow[]> {
  const { data: rows } = await admin
    .from("pricing_items")
    .select("code,name,active")
    .eq("type", "extra")
    .eq("active", true);
  return (rows ?? []).map((r) => ({
    code: String(r.code ?? ""),
    name: String(r.name ?? ""),
  }));
}

/** Map logical alias code to the active pricing_items.code (handles encerado vs encerrado spelling). */
function canonicalizeExtraCode(logicalCode: string, active: ActiveExtraRow[]): string | null {
  const want = foldText(logicalCode);
  const exact = active.find((r) => foldText(r.code) === want);
  if (exact) return exact.code;

  if (want.includes("encer")) {
    const wax = active.find((r) => {
      const c = foldText(r.code);
      const n = foldText(r.name);
      return c.includes("encer") || n.includes("encer");
    });
    if (wax) return wax.code;
  }

  if (want.includes("pelo") || want.includes("mascot")) {
    const m = active.find((r) => foldText(r.code).includes("pelo") || foldText(r.code).includes("mascot"));
    if (m) return m.code;
  }
  if (want.includes("barro") || want === "sucio" || want.includes("muy sucio")) {
    const b = active.find((r) => foldText(r.code).includes("barro") || foldText(r.code).includes("sucio"));
    if (b) return b.code;
  }
  if (want.includes("interior") || want.includes("detallado")) {
    const d = active.find((r) => foldText(r.code).includes("interior") || foldText(r.code).includes("detallado"));
    if (d) return d.code;
  }
  if (want.includes("olor") || want.includes("eliminacion")) {
    const o = active.find((r) => foldText(r.code).includes("olor") || foldText(r.code).includes("eliminacion"));
    if (o) return o.code;
  }

  return null;
}

function fuzzyMatchExtraCode(token: string, active: ActiveExtraRow[]): string | null {
  const t = foldText(repairUtf8Mojibake(token));
  if (!t) return null;
  const match = active.find((r) => {
    const code = foldText(r.code);
    const name = foldText(r.name);
    return t === code || t.includes(code) || code.includes(t) || t.includes(name) || name.includes(t);
  });
  return match?.code ?? null;
}

/** Map free-text extras to pricing_items extra codes (deduped, stable order). */
export function normalizeFreeTextExtraCodes(tokens: string[]): string[] {
  const codes: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const code = extraCodeFromToken(token);
    if (code && !seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  }
  return codes;
}

export function normalizeFreeTextExtras(raw: unknown): {
  input_extras: string;
  normalized_extras: string[];
} {
  const tokens = parseFreeTextExtrasInput(raw);
  const input_extras = tokens.length
    ? tokens.join(", ")
    : raw == null
    ? ""
    : String(raw).trim();
  return {
    input_extras,
    normalized_extras: normalizeFreeTextExtraCodes(tokens),
  };
}

export type FreeTextExtrasResolution = {
  input_extras: string;
  normalized_extras: string[];
  invalid_extra_tokens: string[];
  available_extra_codes: string[];
};

function resolveTokensToExtraCodes(
  tokens: string[],
  active: ActiveExtraRow[],
): { normalized_extras: string[]; invalid_extra_tokens: string[] } {
  const normalized_extras: string[] = [];
  const invalid_extra_tokens: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    if (isNoneExtraToken(token)) continue;

    const logical = extraCodeFromToken(token) ?? fuzzyMatchExtraCode(token, active);
    if (!logical) {
      invalid_extra_tokens.push(token);
      continue;
    }

    const canonical = canonicalizeExtraCode(logical, active);
    if (!canonical) {
      invalid_extra_tokens.push(token);
      continue;
    }
    if (!seen.has(canonical)) {
      seen.add(canonical);
      normalized_extras.push(canonical);
    }
  }

  return { normalized_extras, invalid_extra_tokens };
}

/** Alias map + DB canonical codes for unmatched spellings (e.g. encerado vs encerrado). */
export async function resolveFreeTextExtras(
  admin: SupabaseClient,
  raw: unknown,
): Promise<FreeTextExtrasResolution> {
  const tokens = parseFreeTextExtrasInput(raw);
  const input_extras = tokens.length
    ? tokens.join(", ")
    : raw == null
    ? ""
    : String(raw).trim();
  const active = await loadActiveExtraRows(admin);
  const available_extra_codes = active.map((r) => r.code);
  const { normalized_extras, invalid_extra_tokens } = resolveTokensToExtraCodes(tokens, active);
  return {
    input_extras,
    normalized_extras,
    invalid_extra_tokens,
    available_extra_codes,
  };
}

export async function loadVehiclePricingItem(
  admin: SupabaseClient,
  code: string,
): Promise<{ code: string; name: string; amount: number; duration_minutes: number } | null> {
  const vehicleCode = normalizeVehiclePricingCode(code);
  const withDuration = await admin
    .from("pricing_items")
    .select("code,name,amount,duration_minutes,active")
    .eq("type", "vehicle_surcharge")
    .eq("code", vehicleCode)
    .eq("active", true)
    .maybeSingle();
  const row = !withDuration.error
    ? withDuration.data
    : (
      await admin
        .from("pricing_items")
        .select("code,name,amount,active")
        .eq("type", "vehicle_surcharge")
        .eq("code", vehicleCode)
        .eq("active", true)
        .maybeSingle()
    ).data;
  if (!row) return null;
  return {
    code: String(row.code ?? vehicleCode),
    name: String(row.name ?? "Vehículo"),
    amount: Number(row.amount) || 0,
    duration_minutes: Number((row as { duration_minutes?: number }).duration_minutes) || 0,
  };
}

export async function loadExtraPricingItems(
  admin: SupabaseClient,
  codes: string[],
): Promise<
  | { ok: true; items: PricingExtraLine[]; total: number }
  | { ok: false; missing: string[] }
> {
  if (!codes.length) return { ok: true, items: [], total: 0 };
  const { data: rows } = await admin
    .from("pricing_items")
    .select("code,name,amount,active")
    .eq("type", "extra")
    .in("code", codes);
  const map = new Map<string, PricingExtraLine & { active: boolean }>();
  for (const r of rows ?? []) {
    map.set(String(r.code), {
      code: String(r.code),
      name: String(r.name ?? "Extra"),
      amount: Number(r.amount) || 0,
      active: !!r.active,
    });
  }
  const missing = codes.filter((c) => !map.get(c)?.active);
  if (missing.length) return { ok: false, missing };
  const items: PricingExtraLine[] = [];
  let total = 0;
  for (const c of codes) {
    const e = map.get(c)!;
    items.push({ code: e.code, name: e.name, amount: e.amount });
    total += e.amount;
  }
  return { ok: true, items, total };
}

export function buildQuoteSummary(opts: {
  service_name: string;
  service_base_price: number;
  vehicle_name: string;
  vehicle_surcharge: number;
  selected_extras: PricingExtraLine[];
  total_amount: number;
}): string {
  const lines = [
    "Detalle:",
    `${opts.service_name}: ${formatPriceARS(opts.service_base_price)}`,
    `Vehículo: ${opts.vehicle_name}: ${formatPriceARS(opts.vehicle_surcharge)}`,
  ];
  if (opts.selected_extras.length) {
    lines.push("Extras:");
    for (const e of opts.selected_extras) {
      lines.push(`- ${e.name}: ${formatPriceARS(e.amount)}`);
    }
  } else {
    lines.push("Extras: (ninguno)");
  }
  lines.push(`Total a abonar: ${formatPriceARS(opts.total_amount)}`);
  lines.push("Elegí una opción.");
  return lines.join("\n");
}

export async function calculateBookingQuote(
  admin: SupabaseClient,
  opts: {
    service_id: string;
    service_name?: string;
    service_base_price?: number;
    vehicle_type?: string;
    vehicle_code?: string;
    selected_extras: string[];
  },
): Promise<BookingQuote | { ok: false; reason: "invalid_extra"; missing: string[] }> {
  let service_name = opts.service_name ?? "";
  let service_base_price = opts.service_base_price;
  if (service_base_price == null || !service_name) {
    const { data: svc } = await admin
      .from("services")
      .select("name,base_price,active")
      .eq("id", opts.service_id)
      .maybeSingle();
    if (!svc?.active) {
      service_base_price = 0;
    } else {
      service_name = service_name || String(svc.name ?? "");
      service_base_price = Number(svc.base_price) || 0;
    }
  }
  service_base_price = Number(service_base_price) || 0;

  const vehicleCode = opts.vehicle_code
    ? normalizeVehiclePricingCode(opts.vehicle_code)
    : normalizeVehiclePricingCode(opts.vehicle_type ?? "");
  const vehicle = await loadVehiclePricingItem(admin, vehicleCode);
  const vehicle_surcharge = vehicle?.amount ?? 0;
  const vehicle_name = vehicle?.name ?? vehicleCode;

  const extras = await loadExtraPricingItems(admin, opts.selected_extras);
  if (!extras.ok) return { ok: false, reason: "invalid_extra", missing: extras.missing };

  const extras_total = extras.total;
  const total_amount = service_base_price + vehicle_surcharge + extras_total;
  const selected_extras = extras.items;

  const quote_summary = buildQuoteSummary({
    service_name,
    service_base_price,
    vehicle_name,
    vehicle_surcharge,
    selected_extras,
    total_amount,
  });

  return {
    service_name,
    service_base_price,
    vehicle_code: vehicle?.code ?? vehicleCode,
    vehicle_name,
    vehicle_surcharge,
    extras_total,
    total_amount,
    selected_extras,
    quote_summary,
  };
}
