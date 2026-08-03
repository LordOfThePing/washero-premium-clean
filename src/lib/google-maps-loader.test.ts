import { describe, expect, it } from "vitest";
import {
  GOOGLE_MAPS_PUBLIC_KEY,
  GOOGLE_MAPS_PUBLIC_KEY_ENV,
  GOOGLE_MAPS_PUBLIC_KEY_SOURCE,
  MAPS_LOAD_ERROR_MESSAGES,
  parseMapsLoadFailure,
} from "./google-maps-loader";

describe("google-maps-loader key resolution", () => {
  it("exposes the canonical env var name", () => {
    expect(GOOGLE_MAPS_PUBLIC_KEY_ENV).toBe("VITE_GOOGLE_MAPS_PUBLIC_KEY");
  });

  it("resolves a non-empty Maps browser key in test/dev builds", () => {
    expect(typeof GOOGLE_MAPS_PUBLIC_KEY).toBe("string");
    expect(GOOGLE_MAPS_PUBLIC_KEY?.length).toBeGreaterThan(10);
    expect(GOOGLE_MAPS_PUBLIC_KEY_SOURCE === "missing").toBe(false);
  });

  it("keeps no_key copy actionable for operators", () => {
    expect(MAPS_LOAD_ERROR_MESSAGES.no_key).toContain(GOOGLE_MAPS_PUBLIC_KEY_ENV);
  });

  it("parses known load failure codes", () => {
    expect(parseMapsLoadFailure(new Error("no_key"))).toBe("no_key");
    expect(parseMapsLoadFailure(new Error("places_missing"))).toBe("places_missing");
    expect(parseMapsLoadFailure(new Error("boom"))).toBe("script_failed");
  });
});
