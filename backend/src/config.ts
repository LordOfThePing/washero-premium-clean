import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  port: Number(process.env.PORT ?? 8000),
  host: process.env.HOST ?? "0.0.0.0",
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "3600",
  anonKey: required("ANON_KEY", "washero-anon-key-change-me"),
  serviceRoleKey: required("SERVICE_ROLE_KEY", "washero-service-role-key-change-me"),
  publicSiteUrl: process.env.PUBLIC_SITE_URL ?? "http://localhost:8000",
  storageDir: process.env.STORAGE_DIR ?? "./storage",

  whatsappToolsSecret: process.env.WHATSAPP_TOOLS_SECRET ?? "",
  n8nWhatsappWebhookUrl: process.env.N8N_WHATSAPP_WEBHOOK_URL ?? "",
  n8nWhatsappWebhookSecret: process.env.N8N_WHATSAPP_WEBHOOK_SECRET ?? "",
  mercadopagoAccessToken: process.env.MERCADOPAGO_ACCESS_TOKEN ?? "",
  mercadopagoWebhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET ?? "",
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:admin@washero.ar",
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL ?? "",
  n8nWebhookSecret: process.env.N8N_WEBHOOK_SECRET ?? "",
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
  googleSheetsExpensesUrl: process.env.GOOGLE_SHEETS_EXPENSES_URL ?? "",
};
