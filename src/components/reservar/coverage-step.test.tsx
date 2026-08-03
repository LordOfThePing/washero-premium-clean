import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const invokeMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

vi.mock("@/components/PlacesAutocomplete", () => ({
  PlacesAutocomplete: ({
    onSelect,
  }: {
    onSelect: (
      place: {
        place_id: string;
        formatted_address: string;
        lat: number;
        lng: number;
        neighborhood: string | null;
        locality_candidates: string[];
        address_components: Array<{ long_name?: string; types?: string[] }>;
      } | null,
    ) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onSelect({
          place_id: "place-msavio",
          formatted_address: "EDG, Aconcagua 27, B1620 Maquinista Savio, Provincia de Buenos Aires",
          lat: -34.4,
          lng: -58.7,
          neighborhood: "Maquinista Savio",
          locality_candidates: ["Maquinista Savio"],
          address_components: [{ long_name: "Maquinista Savio", types: ["locality", "political"] }],
        })
      }
    >
      Seleccionar Maquinista Savio
    </button>
  ),
}));

vi.mock("@/lib/google-ads", () => ({
  completeWebsiteBookingSuccess: vi.fn(),
  getCreateWebsiteBookingId: vi.fn(),
  parseCreateWebsiteBookingResponse: vi.fn(),
  trackGoogleAdsEvent: vi.fn(),
}));

import { AddressFirstFlow } from "./AddressFirstFlow";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("AddressFirstFlow coverage step", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    fromMock.mockReset();

    fromMock.mockImplementation((table: string) => {
      const result =
        table === "coverage_zones"
          ? {
              data: [
                {
                  id: "zone-msavio",
                  name: "Maquinista Savio",
                  aliases: [],
                  display_order: 8,
                },
              ],
              error: null,
            }
          : table === "private_neighborhoods"
            ? { data: [], error: null }
            : table === "services"
              ? {
                  data: [
                    {
                      id: "svc-1",
                      name: "Lavado",
                      description: null,
                      base_price: 25000,
                      duration_minutes: 60,
                    },
                  ],
                  error: null,
                }
              : table === "pricing_items"
                ? { data: [], error: null }
                : { data: [], error: null };

      const builder: Record<string, unknown> = {};
      const self = () => builder;
      builder.select = self;
      builder.eq = self;
      builder.order = self;
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(result).then(resolve);
      return builder;
    });

    invokeMock.mockResolvedValue({
      data: {
        ok: true,
        inside_coverage: true,
        zone: { id: "zone-msavio", name: "Maquinista Savio" },
      },
      error: null,
    });
  });

  it("enables Elegir servicio when selected Google place matches an active coverage zone", async () => {
    render(<AddressFirstFlow />, { wrapper });

    const selectButton = await screen.findByRole("button", {
      name: "Seleccionar Maquinista Savio",
    });
    selectButton.click();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalled();
    });

    const next = await screen.findByRole("button", { name: /Elegir servicio/i });
    await waitFor(() => {
      expect(next).not.toBeDisabled();
    });
    expect(screen.getByText(/Zona:\s*Maquinista Savio/i)).toBeInTheDocument();
    expect(screen.queryByText(/Por ahora Washero trabaja en/i)).not.toBeInTheDocument();
  });
});
