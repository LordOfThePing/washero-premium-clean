import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { CheckCircle2, MessageCircle, Home, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const WHATSAPP_URL = "https://wa.me/5491176247835";

type LastBooking = {
  service_name: string;
  scheduled_date: string;
  scheduled_time: string;
  address: string;
  neighborhood: string;
  price: number;
  payment_method: string;
  booking_status: "pending" | "needs_review";
};

const searchSchema = z.object({
  payment: z.enum(["success", "pending", "failure"]).optional(),
});

function formatARS(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}
function formatDateLong(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(dt);
}

export const Route = createFileRoute("/_public/gracias")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [{ title: "Reserva recibida — Washero" }],
  }),
  component: GraciasPage,
});

type PaymentState = "success" | "pending" | "failure" | null;

function paymentCopy(state: PaymentState) {
  switch (state) {
    case "success":
      return {
        icon: CheckCircle2,
        tone: "success" as const,
        title: "Reserva recibida y pago iniciado",
        text: "Reserva recibida y pago iniciado correctamente. Te vamos a confirmar por WhatsApp.",
      };
    case "pending":
      return {
        icon: Clock,
        tone: "pending" as const,
        title: "Reserva recibida — pago pendiente",
        text: "Reserva recibida. El pago está pendiente de confirmación.",
      };
    case "failure":
      return {
        icon: AlertTriangle,
        tone: "failure" as const,
        title: "Reserva recibida — pago no completado",
        text: "Reserva recibida, pero el pago no se completó. Te vamos a contactar para coordinar.",
      };
    default:
      return {
        icon: CheckCircle2,
        tone: "success" as const,
        title: "Reserva recibida 🚗✨",
        text:
          "Gracias por reservar con Washero. Recibimos tu solicitud y vamos a confirmarte los detalles por WhatsApp.",
      };
  }
}

function GraciasPage() {
  const { payment } = Route.useSearch();
  const [last, setLast] = useState<LastBooking | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("washero:last-booking");
      if (raw) setLast(JSON.parse(raw) as LastBooking);
    } catch {
      // ignore
    }
  }, []);

  const needsReview = last?.booking_status === "needs_review";
  const copy = paymentCopy(payment ?? null);
  const Icon = copy.icon;

  const toneClasses =
    copy.tone === "success"
      ? "bg-primary/15 text-primary"
      : copy.tone === "pending"
      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
      : "bg-destructive/15 text-destructive";

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:py-20">
      <Card className="border-border/60">
        <CardContent className="flex flex-col items-center p-8 text-center sm:p-10">
          <div className={`flex h-14 w-14 items-center justify-center rounded-full ${toneClasses}`}>
            <Icon className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
            {copy.title}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{copy.text}</p>

          {last && (
            <div className="mt-6 w-full rounded-lg border bg-muted/30 p-4 text-left text-sm">
              <Row label="Servicio" value={last.service_name} />
              <Row label="Fecha" value={formatDateLong(last.scheduled_date)} />
              <Row label="Horario" value={last.scheduled_time?.slice(0, 5)} />
              <Row label="Dirección" value={`${last.address}, ${last.neighborhood}`} />
              <Separator className="my-3" />
              <Row label="Método de pago" value={last.payment_method} />
              <Row
                label="Total"
                value={<span className="font-semibold text-primary">{formatARS(last.price)}</span>}
              />
            </div>
          )}

          {needsReview && (
            <div className="mt-4 w-full rounded-md border border-primary/30 bg-primary/5 p-3 text-left text-xs">
              Tu zona requiere confirmación manual. Te escribimos por WhatsApp para confirmar disponibilidad.
            </div>
          )}

          <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
            <Button asChild size="lg">
              <Link to="/">
                <Home className="mr-2 h-4 w-4" /> Volver al inicio
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={WHATSAPP_URL} target="_blank" rel="noreferrer">
                <MessageCircle className="mr-2 h-4 w-4" /> Escribir por WhatsApp
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
