import { Link } from "@tanstack/react-router";
import {
  Calendar,
  ChevronDown,
  MapPin,
  MessageCircle,
  Sparkles,
  X,
} from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { WasheroMascot3D } from "@/components/brand/WasheroMascot3D";
import {
  useMascotSectionState,
  type MascotModelState,
  type MascotSectionId,
} from "@/hooks/useMascotSectionState";
import { useIsMobile } from "@/hooks/use-mobile";

const WA_URL = "https://wa.me/5491176247835";

type AssistantContextValue = ReturnType<typeof useMascotSectionState> & {
  isMobile: boolean;
  hasMounted: boolean;
};

const WasheroAssistantContext = createContext<AssistantContextValue | null>(null);

function useAssistantContext() {
  const ctx = useContext(WasheroAssistantContext);
  if (!ctx) {
    throw new Error("WasheroAssistant components must be used within WasheroAssistantProvider");
  }
  return ctx;
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function SpeechBubble({
  message,
  compact = false,
  showQuickActions = true,
  onReservar,
}: {
  message: string;
  compact?: boolean;
  showQuickActions?: boolean;
  onReservar?: () => void;
}) {
  return (
    <div
      className={`washero-assistant-bubble ${compact ? "washero-assistant-bubble--compact" : ""}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="washero-assistant-bubble-accent" aria-hidden />
      <p key={message} className="washero-assistant-bubble-text washero-assistant-bubble-text--animate">
        {message}
      </p>
      {showQuickActions && !compact ? (
        <div className="washero-assistant-bubble-actions">
          <button type="button" className="washero-assistant-action" onClick={onReservar}>
            Reservar
          </button>
          <a
            href={WA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="washero-assistant-action washero-assistant-action--secondary"
          >
            WhatsApp
          </a>
        </div>
      ) : null}
    </div>
  );
}

function AssistantMenu({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="washero-assistant-menu" data-mascot-menu role="menu" aria-label="Menú de Washi">
      <div className="washero-assistant-menu-header">
        <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-300">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Washi
        </span>
        <button
          type="button"
          className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
          onClick={onClose}
          aria-label="Cerrar menú"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="washero-assistant-menu-list">
        <li>
          <Link to="/reservar" className="washero-assistant-menu-item" role="menuitem" onClick={onClose}>
            <Calendar className="h-4 w-4 text-primary" />
            Reservar lavado
          </Link>
        </li>
        <li>
          <a
            href={WA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="washero-assistant-menu-item"
            role="menuitem"
            onClick={onClose}
          >
            <MessageCircle className="h-4 w-4 text-primary" />
            Consultar por WhatsApp
          </a>
        </li>
        <li>
          <button
            type="button"
            className="washero-assistant-menu-item w-full"
            role="menuitem"
            onClick={() => {
              scrollToSection("zonas");
              onClose();
            }}
          >
            <MapPin className="h-4 w-4 text-primary" />
            Ver zonas
          </button>
        </li>
        <li>
          <button
            type="button"
            className="washero-assistant-menu-item w-full"
            role="menuitem"
            onClick={() => {
              scrollToSection("servicios");
              onClose();
            }}
          >
            <Sparkles className="h-4 w-4 text-primary" />
            Ver servicios
          </button>
        </li>
      </ul>
    </div>
  );
}

function DesktopAssistant({
  modelState,
  message,
  layoutMode,
  nearFooter,
  menuOpen,
  toggleMenu,
  closeMenu,
  activeSection,
  interactionMode,
}: {
  modelState: MascotModelState;
  message: string;
  layoutMode: "hero" | "sticky";
  nearFooter: boolean;
  menuOpen: boolean;
  toggleMenu: () => void;
  closeMenu: () => void;
  activeSection: MascotSectionId;
  interactionMode: ReturnType<typeof useMascotSectionState>["interactionMode"];
}) {
  const isSticky = layoutMode === "sticky";

  const handleReservar = () => {
    const heroReservar = document.querySelector<HTMLElement>('[data-mascot-trigger="reservar"]');
    if (heroReservar) {
      heroReservar.click();
      return;
    }
    window.location.href = "/reservar";
  };

  return (
    <div
      className={[
        "washero-assistant-desktop",
        isSticky ? "washero-assistant-desktop--sticky" : "washero-assistant-desktop--hero",
        nearFooter ? "washero-assistant-desktop--hidden" : "",
        modelState.scaleClass,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="washero-assistant-desktop-inner">
        <SpeechBubble
          message={message}
          compact={isSticky}
          showQuickActions={!isSticky}
          onReservar={handleReservar}
        />
        <button
          type="button"
          className="washero-assistant-mascot-trigger"
          data-mascot-toggle
          onClick={toggleMenu}
          aria-label="Abrir menú de asistente Washi"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <WasheroMascot3D
            modelState={modelState}
            compact={isSticky}
            activeSection={activeSection}
            interactionMode={interactionMode}
            className={isSticky ? "washero-mascot--sticky" : ""}
          />
        </button>
        <AssistantMenu open={menuOpen} onClose={closeMenu} />
      </div>
    </div>
  );
}

function MobileAssistantChip({
  message,
  menuOpen,
  toggleMenu,
  closeMenu,
}: {
  message: string;
  menuOpen: boolean;
  toggleMenu: () => void;
  closeMenu: () => void;
}) {
  return (
    <div className="washero-assistant-mobile mt-5 md:hidden">
      <button
        type="button"
        className="washero-assistant-mobile-chip"
        data-mascot-toggle
        onClick={toggleMenu}
        aria-label="Asistente Washi"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
      >
        <span className="washero-assistant-mobile-avatar" aria-hidden>
          <img
            src="/models/washero-mascot-poster.webp"
            alt=""
            width={32}
            height={32}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-contain"
          />
        </span>
        <span className="washero-assistant-mobile-label">Washi</span>
        <span className="washero-assistant-mobile-message washero-assistant-bubble-text--animate" key={message}>
          {message}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${menuOpen ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {menuOpen ? (
        <div className="washero-assistant-mobile-menu" data-mascot-menu>
          <AssistantMenu open={menuOpen} onClose={closeMenu} />
        </div>
      ) : null}
    </div>
  );
}

export function WasheroAssistantProvider({ children }: { children: ReactNode }) {
  const state = useMascotSectionState();
  const isMobile = useIsMobile();
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  return (
    <WasheroAssistantContext.Provider value={{ ...state, isMobile, hasMounted }}>
      {children}
    </WasheroAssistantContext.Provider>
  );
}

/** Large mascot + bubble in the hero grid (desktop). */
export function WasheroAssistantHero() {
  const {
    isMobile,
    hasMounted,
    modelState,
    displayMessage,
    layoutMode,
    nearFooter,
    menuOpen,
    toggleMenu,
    closeMenu,
    activeSection,
    interactionMode,
  } = useAssistantContext();

  if (!hasMounted || isMobile) return null;

  return (
    <DesktopAssistant
      modelState={modelState}
      message={displayMessage}
      layoutMode={layoutMode}
      nearFooter={nearFooter}
      menuOpen={menuOpen}
      toggleMenu={toggleMenu}
      closeMenu={closeMenu}
      activeSection={activeSection}
      interactionMode={interactionMode}
    />
  );
}

/** Compact Washi chip below hero CTAs (mobile only). */
export function WasheroAssistantMobile() {
  const { isMobile, hasMounted, mobileMessage, menuOpen, toggleMenu, closeMenu } =
    useAssistantContext();

  if (!hasMounted || !isMobile) return null;

  return (
    <MobileAssistantChip
      message={mobileMessage}
      menuOpen={menuOpen}
      toggleMenu={toggleMenu}
      closeMenu={closeMenu}
    />
  );
}

/** Standalone assistant (provider not required). */
export function WasheroAssistant({ className = "" }: { className?: string }) {
  const state = useMascotSectionState();
  const isMobile = useIsMobile();
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!hasMounted) return null;

  if (isMobile) {
    return (
      <MobileAssistantChip
        message={state.mobileMessage}
        menuOpen={state.menuOpen}
        toggleMenu={state.toggleMenu}
        closeMenu={state.closeMenu}
      />
    );
  }

  return (
    <div className={className}>
      <DesktopAssistant
        modelState={state.modelState}
        message={state.displayMessage}
        layoutMode={state.layoutMode}
        nearFooter={state.nearFooter}
        menuOpen={state.menuOpen}
        toggleMenu={state.toggleMenu}
        closeMenu={state.closeMenu}
        activeSection={state.activeSection}
        interactionMode={state.interactionMode}
      />
    </div>
  );
}
