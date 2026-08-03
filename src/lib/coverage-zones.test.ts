import { describe, expect, it } from "vitest";
import {
  extractLocalityCandidates,
  formatCoverageCopy,
  matchCoverageZone,
  normalizeCoverageText,
  sortCoverageZoneNames,
  type MatchableCoverageZone,
} from "./coverage-zones";

function zone(partial: Partial<MatchableCoverageZone> & { name: string }): MatchableCoverageZone {
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name,
    aliases: partial.aliases ?? [],
    active: partial.active ?? true,
    display_order: partial.display_order ?? 0,
  };
}

const activeZones = [
  zone({ name: "Maquinista Savio", display_order: 8 }),
  zone({ name: "Garín", aliases: ["Garin"], display_order: 4 }),
  zone({ name: "Benavídez", aliases: ["Benavidez"], display_order: 3 }),
  zone({ name: "Dique Luján", aliases: ["Dique Lujan"], display_order: 5 }),
  zone({ name: "Escobar", display_order: 2 }),
];

describe("normalizeCoverageText", () => {
  it("folds accents, case, punctuation and whitespace", () => {
    expect(normalizeCoverageText("  Garín  ")).toBe("garin");
    expect(normalizeCoverageText("Benavídez")).toBe("benavidez");
    expect(normalizeCoverageText("Dique  Luján")).toBe("dique lujan");
    expect(normalizeCoverageText("Garin")).toBe(normalizeCoverageText("Garín"));
  });
});

describe("matchCoverageZone", () => {
  it("matches Maquinista Savio from Google locality components", () => {
    const candidates = extractLocalityCandidates([
      { long_name: "Maquinista Savio", types: ["locality", "political"] },
      {
        long_name: "Provincia de Buenos Aires",
        types: ["administrative_area_level_1", "political"],
      },
    ]);
    const match = matchCoverageZone(activeZones, {
      localityCandidates: candidates,
      neighborhood: "Maquinista Savio",
    });
    expect(match.zone?.name).toBe("Maquinista Savio");
    expect(match.match_type).toBe("alias");
  });

  it("normalizes accented zone names", () => {
    expect(matchCoverageZone(activeZones, { localityCandidates: ["Garin"] }).zone?.name).toBe(
      "Garín",
    );
    expect(matchCoverageZone(activeZones, { localityCandidates: ["Benavidez"] }).zone?.name).toBe(
      "Benavídez",
    );
    expect(matchCoverageZone(activeZones, { localityCandidates: ["Dique Lujan"] }).zone?.name).toBe(
      "Dique Luján",
    );
  });

  it("rejects inactive and unrelated localities", () => {
    expect(
      matchCoverageZone([zone({ name: "Maquinista Savio", active: false })], {
        localityCandidates: ["Maquinista Savio"],
      }).zone,
    ).toBeNull();
    expect(matchCoverageZone(activeZones, { localityCandidates: ["Pilar"] }).zone).toBeNull();
  });

  it("matches locality, sublocality_level_1 and neighborhood components", () => {
    expect(
      matchCoverageZone(activeZones, {
        localityCandidates: extractLocalityCandidates([
          { long_name: "Maquinista Savio", types: ["locality"] },
        ]),
      }).zone?.name,
    ).toBe("Maquinista Savio");
    expect(
      matchCoverageZone(activeZones, {
        localityCandidates: extractLocalityCandidates([
          { long_name: "Garín", types: ["sublocality_level_1"] },
        ]),
      }).zone?.name,
    ).toBe("Garín");
    expect(
      matchCoverageZone(activeZones, {
        localityCandidates: extractLocalityCandidates([
          { long_name: "Benavídez", types: ["neighborhood"] },
        ]),
      }).zone?.name,
    ).toBe("Benavídez");
  });

  it("does not match broad administrative areas alone", () => {
    const match = matchCoverageZone(activeZones, {
      localityCandidates: extractLocalityCandidates([
        {
          long_name: "Provincia de Buenos Aires",
          types: ["administrative_area_level_1", "political"],
        },
      ]),
      neighborhood: "Provincia de Buenos Aires",
    });
    expect(match.zone).toBeNull();
  });
});

describe("formatCoverageCopy", () => {
  it("builds dynamic copy from active zones only", () => {
    const names = sortCoverageZoneNames(
      [...activeZones, zone({ name: "Inactive Town", active: false, display_order: 1 })].filter(
        (z) => z.active !== false,
      ),
    );
    const copy = formatCoverageCopy(names);
    expect(copy).toContain("Maquinista Savio");
    expect(copy).not.toContain("Inactive Town");
    expect(formatCoverageCopy([])).toContain("no hay zonas");
    expect(formatCoverageCopy(["Escobar"])).toBe("Por ahora Washero trabaja en Escobar.");
    expect(formatCoverageCopy(["Escobar", "Garín"])).toBe(
      "Por ahora Washero trabaja en Escobar y Garín.",
    );
  });
});
