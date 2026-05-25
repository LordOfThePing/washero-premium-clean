export type OperatorWhatsappAction =
  | "operator_on_the_way"
  | "operator_arrived"
  | "operator_delayed"
  | "operator_access_needed"
  | "operator_wash_completed"
  | "operator_payment_reminder";

export type OperatorTemplateVars = {
  firstName: string;
  bookingTime: string;
  bookingDate: string;
  address: string;
  eta: number;
  receiptUrl: string | null;
};

export type OperatorTemplateDef = {
  action: OperatorWhatsappAction;
  templateKey: string;
  buildMessage: (vars: OperatorTemplateVars) => string;
};

export const OPERATOR_WHATSAPP_TEMPLATES: Record<OperatorWhatsappAction, OperatorTemplateDef> = {
  operator_on_the_way: {
    action: "operator_on_the_way",
    templateKey: "operator_on_the_way",
    buildMessage: (v) =>
      `Hola ${v.firstName}, ya estoy en camino para tu lavado de las ${v.bookingTime}. Llego en aproximadamente ${v.eta} minutos.`,
  },
  operator_arrived: {
    action: "operator_arrived",
    templateKey: "operator_arrived",
    buildMessage: (v) =>
      `Hola ${v.firstName}, ya llegué a ${v.address}. Cuando puedas, te espero para comenzar el lavado.`,
  },
  operator_delayed: {
    action: "operator_delayed",
    templateKey: "operator_delayed",
    buildMessage: (v) =>
      `Hola ${v.firstName}, voy con una demora operativa. Te aviso apenas esté saliendo para allá. Gracias por la paciencia.`,
  },
  operator_access_needed: {
    action: "operator_access_needed",
    templateKey: "operator_access_needed",
    buildMessage: (v) =>
      `Hola ${v.firstName}, ya estoy en la ubicación y necesito acceso para iniciar el lavado. ¿Me ayudás, por favor?`,
  },
  operator_wash_completed: {
    action: "operator_wash_completed",
    templateKey: "operator_wash_completed",
    buildMessage: (v) =>
      `Hola ${v.firstName}, terminamos tu lavado Washero de hoy (${v.bookingDate}).${v.receiptUrl ? ` Podés ver tu comprobante acá: ${v.receiptUrl}` : ""}`,
  },
  operator_payment_reminder: {
    action: "operator_payment_reminder",
    templateKey: "operator_payment_reminder",
    buildMessage: (v) =>
      `Hola ${v.firstName}, te recordamos que el pago de tu lavado sigue pendiente. Si ya abonaste, avisanos por este medio.`,
  },
};

const ALL_ACTIONS = Object.keys(OPERATOR_WHATSAPP_TEMPLATES) as OperatorWhatsappAction[];

export function parseOperatorWhatsappAction(raw: unknown): OperatorWhatsappAction | null {
  const key = String(raw ?? "").trim() as OperatorWhatsappAction;
  return ALL_ACTIONS.includes(key) ? key : null;
}

/** Approved template keys in Botmaker (comma-separated env). Empty = all operator templates allowed. */
export function isOperatorTemplateConfigured(templateKey: string): boolean {
  const configured = (Deno.env.get("BOTMAKER_CONFIGURED_TEMPLATES") ?? "").trim();
  if (!configured) return true;
  const allowed = configured.split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.includes(templateKey);
}

export function getOperatorTemplate(action: OperatorWhatsappAction): OperatorTemplateDef {
  return OPERATOR_WHATSAPP_TEMPLATES[action];
}
