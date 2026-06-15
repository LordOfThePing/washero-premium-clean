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
}

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
    const reservarTriggers = document.querySelectorAll<HTMLElement>(
      '[data-mascot-trigger="reservar"]',
    );
    const whatsappTriggers = document.querySelectorAll<HTMLElement>(
      '[data-mascot-trigger="whatsapp"]',
    );

    const onReservarEnter = () => setHoverTrigger("reservar");
    const onWhatsappEnter = () => setHoverTrigger("whatsapp");
    const onLeave = () => setHoverTrigger(null);

    for (const el of reservarTriggers) {
      el.addEventListener("mouseenter", onReservarEnter);
      el.addEventListener("mouseleave", onLeave);
      el.addEventListener("focus", onReservarEnter);
      el.addEventListener("blur", onLeave);
    }

    for (const el of whatsappTriggers) {
      el.addEventListener("mouseenter", onWhatsappEnter);
      el.addEventListener("mouseleave", onLeave);
      el.addEventListener("focus", onWhatsappEnter);
      el.addEventListener("blur", onLeave);
    }

    return () => {
      for (const el of reservarTriggers) {
        el.removeEventListener("mouseenter", onReservarEnter);
        el.removeEventListener("mouseleave", onLeave);
        el.removeEventListener("focus", onReservarEnter);
        el.removeEventListener("blur", onLeave);
      }
      for (const el of whatsappTriggers) {
        el.removeEventListener("mouseenter", onWhatsappEnter);
        el.removeEventListener("mouseleave", onLeave);
        el.removeEventListener("focus", onWhatsappEnter);
        el.removeEventListener("blur", onLeave);
      }
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

  return {
    activeSection,
    isInHero,
    nearFooter,
    hoverTrigger,
    menuOpen,
    toggleMenu,
    closeMenu,
    displayMessage,
    mobileMessage,
    modelState: sectionConfig.model,
    layoutMode: isInHero ? ("hero" as const) : ("sticky" as const),
  };
}
