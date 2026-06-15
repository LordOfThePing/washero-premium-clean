import { useCallback, useEffect, useMemo, useState } from "react";

export type MascotSectionId =
  | "hero"
  | "como-funciona"
  | "reservar"
  | "zonas"
  | "servicios";

export type MascotHoverTrigger = "reservar" | "whatsapp" | null;

export interface MascotModelState {
  cameraOrbit: string;
  autoRotate: boolean;
  autoRotateDelay: number;
  rotationPerSecond: string;
  exposure: string;
  shadowIntensity: string;
  scaleClass: string;
  /** GLB clip name when the asset ships with animations (none today). */
  animationName?: string;
}

export type MascotInteractionMode = "idle" | "hover-reservar" | "hover-whatsapp" | "menu-open";

export interface MascotSectionConfig {
  message: string;
  mobileMessage: string;
  model: MascotModelState;
}

const SECTION_ORDER: MascotSectionId[] = [
  "hero",
  "como-funciona",
  "servicios",
  "zonas",
  "reservar",
];

export const MASCOT_SECTIONS: Record<MascotSectionId, MascotSectionConfig> = {
  hero: {
    message: "Hola, soy Washi 👋 Te ayudo a reservar tu lavado.",
    mobileMessage: "Hola, soy Washi 👋",
    model: {
      cameraOrbit: "20deg 75deg 105%",
      autoRotate: true,
      autoRotateDelay: 0,
      rotationPerSecond: "12deg",
      exposure: "1.05",
      shadowIntensity: "0.85",
      scaleClass: "scale-100",
    },
  },
  "como-funciona": {
    message: "Es simple: elegís zona, horario y listo.",
    mobileMessage: "Elegís zona, horario y listo.",
    model: {
      cameraOrbit: "-20deg 75deg 105%",
      autoRotate: true,
      autoRotateDelay: 500,
      rotationPerSecond: "10deg",
      exposure: "1.05",
      shadowIntensity: "0.8",
      scaleClass: "scale-[0.98]",
    },
  },
  reservar: {
    message: "Acá podés reservar en menos de 1 minuto.",
    mobileMessage: "Reservá en menos de 1 minuto.",
    model: {
      cameraOrbit: "0deg 70deg 95%",
      autoRotate: true,
      autoRotateDelay: 800,
      rotationPerSecond: "8deg",
      exposure: "1.1",
      shadowIntensity: "0.9",
      scaleClass: "scale-[0.96]",
    },
  },
  zonas: {
    message: "Trabajamos en Zona Norte y barrios cerrados.",
    mobileMessage: "Zona Norte y barrios cerrados.",
    model: {
      cameraOrbit: "30deg 80deg 110%",
      autoRotate: true,
      autoRotateDelay: 600,
      rotationPerSecond: "10deg",
      exposure: "1.05",
      shadowIntensity: "0.85",
      scaleClass: "scale-[0.97]",
    },
  },
  servicios: {
    message: "Elegí el lavado que mejor va con tu auto.",
    mobileMessage: "Elegí tu lavado ideal.",
    model: {
      cameraOrbit: "-30deg 78deg 105%",
      autoRotate: true,
      autoRotateDelay: 600,
      rotationPerSecond: "10deg",
      exposure: "1.08",
      shadowIntensity: "0.88",
      scaleClass: "scale-[0.97]",
    },
  },
};

const HOVER_MESSAGES: Record<Exclude<MascotHoverTrigger, null>, string> = {
  reservar: "Dale, reservamos ahora 🚗✨",
  whatsapp: "También podés escribirme por WhatsApp.",
};

const INTERACTION_MODEL_OVERRIDES: Record<
  Exclude<MascotInteractionMode, "idle">,
  Partial<MascotModelState>
> = {
  "hover-reservar": {
    cameraOrbit: "0deg 72deg 92%",
    rotationPerSecond: "18deg",
    exposure: "1.15",
    shadowIntensity: "0.92",
    autoRotateDelay: 0,
  },
  "hover-whatsapp": {
    cameraOrbit: "28deg 76deg 108%",
    rotationPerSecond: "14deg",
    exposure: "1.08",
    autoRotateDelay: 200,
  },
  "menu-open": {
    autoRotate: false,
    rotationPerSecond: "0deg",
    cameraOrbit: "15deg 74deg 100%",
    exposure: "1.1",
  },
};

function mergeModelState(base: MascotModelState, mode: MascotInteractionMode): MascotModelState {
  if (mode === "idle") return base;
  return { ...base, ...INTERACTION_MODEL_OVERRIDES[mode] };
}

const SECTION_SELECTOR = "[data-mascot-section]";
const FOOTER_SELECTOR = "[data-mascot-footer]";

function pickActiveSection(ratios: Map<MascotSectionId, number>): MascotSectionId {
  let best: MascotSectionId = "hero";
  let bestRatio = 0;

  for (const id of SECTION_ORDER) {
    const ratio = ratios.get(id) ?? 0;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = id;
    }
  }

  return best;
}

export function useMascotSectionState() {
  const [activeSection, setActiveSection] = useState<MascotSectionId>("hero");
  const [isInHero, setIsInHero] = useState(true);
  const [nearFooter, setNearFooter] = useState(false);
  const [hoverTrigger, setHoverTrigger] = useState<MascotHoverTrigger>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleMenu = useCallback(() => {
    setMenuOpen((open) => !open);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  useEffect(() => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>(SECTION_SELECTOR),
    );
    if (sections.length === 0) return;

    const ratios = new Map<MascotSectionId, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute("data-mascot-section") as MascotSectionId | null;
          if (!id) continue;
          ratios.set(id, entry.intersectionRatio);
        }

        const next = pickActiveSection(ratios);
        setActiveSection(next);

        const heroRatio = ratios.get("hero") ?? 0;
        setIsInHero(heroRatio > 0.35);
      },
      {
        threshold: [0, 0.15, 0.35, 0.5, 0.65, 0.85, 1],
        rootMargin: "-8% 0px -8% 0px",
      },
    );

    for (const section of sections) observer.observe(section);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const footer = document.querySelector(FOOTER_SELECTOR);
    if (!footer) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setNearFooter(!!entry?.isIntersecting);
      },
      { rootMargin: "0px", threshold: 0.05 },
    );

    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const readTrigger = (target: EventTarget | null): MascotHoverTrigger => {
      const el = (target as HTMLElement | null)?.closest<HTMLElement>("[data-mascot-trigger]");
      const value = el?.getAttribute("data-mascot-trigger");
      if (value === "reservar" || value === "whatsapp") return value;
      return null;
    };

    const onPointerOver = (e: PointerEvent) => {
      const trigger = readTrigger(e.target);
      if (trigger) setHoverTrigger(trigger);
    };

    const onPointerOut = (e: PointerEvent) => {
      const from = readTrigger(e.target);
      const to = readTrigger(e.relatedTarget);
      if (from && from !== to) setHoverTrigger(null);
    };

    const onFocusIn = (e: FocusEvent) => {
      const trigger = readTrigger(e.target);
      if (trigger) setHoverTrigger(trigger);
    };

    const onFocusOut = (e: FocusEvent) => {
      const from = readTrigger(e.target);
      const to = readTrigger(e.relatedTarget);
      if (from && from !== to) setHoverTrigger(null);
    };

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-mascot-menu]") && !target.closest("[data-mascot-toggle]")) {
        closeMenu();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [menuOpen, closeMenu]);

  const sectionConfig = MASCOT_SECTIONS[activeSection];

  const displayMessage = useMemo(() => {
    if (hoverTrigger) return HOVER_MESSAGES[hoverTrigger];
    return sectionConfig.message;
  }, [hoverTrigger, sectionConfig.message]);

  const mobileMessage = useMemo(() => {
    if (hoverTrigger === "reservar") return "Reservamos ahora 🚗";
    if (hoverTrigger === "whatsapp") return "Escribime por WhatsApp.";
    return sectionConfig.mobileMessage;
  }, [hoverTrigger, sectionConfig.mobileMessage]);

  const interactionMode: MascotInteractionMode = useMemo(() => {
    if (menuOpen) return "menu-open";
    if (hoverTrigger === "reservar") return "hover-reservar";
    if (hoverTrigger === "whatsapp") return "hover-whatsapp";
    return "idle";
  }, [menuOpen, hoverTrigger]);

  const modelState = useMemo(
    () => mergeModelState(sectionConfig.model, interactionMode),
    [sectionConfig.model, interactionMode],
  );

  return {
    activeSection,
    isInHero,
    nearFooter,
    hoverTrigger,
    interactionMode,
    menuOpen,
    toggleMenu,
    closeMenu,
    displayMessage,
    mobileMessage,
    modelState,
    layoutMode: isInHero ? ("hero" as const) : ("sticky" as const),
  };
}
