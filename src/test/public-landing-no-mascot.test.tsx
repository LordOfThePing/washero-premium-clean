import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => ReactNode }) => ({
    options: opts,
  }),
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode; className?: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const builder: Record<string, unknown> = {};
      const self = () => builder;
      const result = { data: [], error: null };
      builder.select = self;
      builder.eq = self;
      builder.order = self;
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(result).then(resolve);
      return builder;
    },
  },
}));

import { Route } from "@/routes/_public.index";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("public landing page without mascot assistant", () => {
  it("renders real booking and WhatsApp CTAs without the 3D mascot UI", () => {
    const LandingPage = Route.options.component!;
    const { container } = render(<LandingPage />, { wrapper });

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Lavado de autos a/i);
    expect(screen.getAllByRole("link", { name: /Reservar lavado/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Consultar por WhatsApp/i }).length).toBeGreaterThan(
      0,
    );

    expect(container.querySelector("model-viewer")).toBeNull();
    expect(container.querySelector("[data-mascot-section]")).toBeNull();
    expect(container.querySelector(".washero-assistant-bubble")).toBeNull();
    expect(container.querySelector(".washero-assistant-bubble-actions")).toBeNull();
    expect(container.querySelector(".washero-assistant-mobile-chip")).toBeNull();
    expect(container.querySelector(".washero-mascot-float")).toBeNull();
    expect(container.querySelector('img[src*="washero-mascot"]')).toBeNull();
    expect(screen.queryByText(/soy Washi/i)).toBeNull();
    expect(screen.queryByLabelText(/Washero mascot/i)).toBeNull();
    // Mascot bubble used a bare "Reservar" button; keep real "Reservar lavado" CTAs.
    expect(screen.queryByRole("button", { name: /^Reservar$/i })).toBeNull();
  });
});
