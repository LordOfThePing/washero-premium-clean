// Small channel-agnostic text/phone helpers, split out of the old vendor-specific
// `botmaker-booking.ts` (which otherwise only contained Botmaker flow-summary parsing that
// no longer applies now that booking is driven by structured tool calls, not free-text
// conversation summaries).

/** Reads the first present string/number value out of an arbitrary payload by trying each
 * dotted path in order. */
export function pick(obj: any, paths: string[]): string | null {
  for (const p of paths) {
    const parts = p.split(".");
    let cur: any = obj;
    let ok = true;
    for (const k of parts) {
      if (cur == null) { ok = false; break; }
      cur = cur[k];
    }
    if (ok && cur != null && cur !== "") {
      if (typeof cur === "string" || typeof cur === "number") return String(cur);
    }
  }
  return null;
}

/** Loose phone normalization: strips WhatsApp-style suffixes/prefixes, keeps leading "+" and
 * digits only. Callers needing the WhatsApp/Argentina-specific "54 9 ..." shape should use
 * normalizeArgentinaWhatsAppPhone from whatsapp-outbound.ts instead. */
export function normalizePhone(v: string | null | undefined): string | null {
  if (!v) return null;
  let s = String(v).trim();
  s = s.replace(/@.*$/, "");
  s = s.replace(/^whatsapp:/i, "");
  s = s.replace(/[^\d+]/g, "");
  return s || null;
}
