import { createFileRoute, redirect } from "@tanstack/react-router";

const QR_SEARCH_BY_SLUG: Record<string, Record<string, string>> = {
  camioneta: {
    utm_source: "offline",
    utm_medium: "qr",
    utm_campaign: "camioneta",
    qr: "camioneta",
  },
  "flyer-poste": {
    utm_source: "offline",
    utm_medium: "qr",
    utm_campaign: "flyer_poste",
    qr: "flyer_poste",
  },
};

export const Route = createFileRoute("/_public/q/$slug")({
  beforeLoad: ({ params }) => {
    const search = QR_SEARCH_BY_SLUG[params.slug];
    if (!search) {
      throw redirect({ to: "/reservar" });
    }
    throw redirect({ to: "/reservar", search });
  },
});
