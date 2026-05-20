import { createFileRoute } from "@tanstack/react-router";

import { AddressFirstFlow } from "@/components/reservar/AddressFirstFlow";
import { CalendarFirstFlow } from "@/components/reservar/CalendarFirstFlow";

const parseFlag = (value: unknown) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
};

const ADDRESS_FIRST_ENABLED = true;

if (import.meta.env.DEV) {
  console.log("[Reservar] Address-first flags", {
    VITE_ADDRESS_FIRST_BOOKING: import.meta.env.VITE_ADDRESS_FIRST_BOOKING,
    VITE_ADDRESS_FIRST_ENABLED: import.meta.env.VITE_ADDRESS_FIRST_ENABLED,
    enabled: ADDRESS_FIRST_ENABLED,
  });
}

export const Route = createFileRoute("/_public/reservar")({
  head: () => ({
    meta: [
      { title: "Reservar lavado — Washero" },
      {
        name: "description",
        content: ADDRESS_FIRST_ENABLED
          ? "Reservá tu lavado a domicilio: ingresá tu dirección y te sugerimos los mejores horarios."
          : "Reservá tu lavado de auto a domicilio en Zona Norte. Elegí día y horario en pocos toques.",
      },
    ],
  }),
  component: ReservarPage,
});

function ReservarPage() {
  return (
    <>
      {import.meta.env.DEV ? (
        <div className="fixed bottom-3 left-3 z-[9999] rounded-full bg-black px-3 py-1 text-xs font-semibold text-white shadow-lg">
          Address-first: {ADDRESS_FIRST_ENABLED ? "ON" : "OFF"}
        </div>
      ) : null}

      {ADDRESS_FIRST_ENABLED ? <AddressFirstFlow /> : <CalendarFirstFlow />}
    </>
  );
}