import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  MASCOT_SECTIONS,
  type MascotInteractionMode,
  type MascotModelState,
  type MascotSectionId,
} from "@/hooks/useMascotSectionState";

const MODEL_SRC = "/models/washero-mascot.optimized.glb";
const POSTER_SRC = "/models/washero-mascot-poster.webp";

const DEFAULT_MODEL_STATE: MascotModelState = MASCOT_SECTIONS.hero.model;

type ModelViewerEl = HTMLElement & {
  availableAnimations?: string[];
  animationName?: string;
  play?: (options?: { repetitions?: number }) => void;
  pause?: () => void;
};

function applyModelState(el: ModelViewerEl, state: MascotModelState) {
  el.setAttribute("camera-orbit", state.cameraOrbit);
  el.setAttribute("shadow-intensity", state.shadowIntensity);
  el.setAttribute("exposure", state.exposure);
  el.setAttribute("rotation-per-second", state.rotationPerSecond);
  el.toggleAttribute("auto-rotate", state.autoRotate);
  el.setAttribute("auto-rotate-delay", String(state.autoRotateDelay));

  if (state.animationName) {
    el.setAttribute("animation-name", state.animationName);
    el.play?.({ repetitions: Infinity });
  } else {
    el.removeAttribute("animation-name");
    el.pause?.();
  }
}

function MascotFallback({ compact }: { compact?: boolean }) {
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-2 text-neutral-400 ${compact ? "py-4" : "py-10"}`}
      aria-hidden
    >
      <div
        className={`flex items-center justify-center rounded-full border border-white/10 bg-white/5 ${compact ? "h-10 w-10" : "h-14 w-14"}`}
      >
        <Sparkles className={`text-primary/80 ${compact ? "h-5 w-5" : "h-6 w-6"}`} />
      </div>
      <span className="text-xs tracking-wide text-neutral-500">Washero</span>
    </div>
  );
}

function MascotShell({
  className = "",
  containerRef,
  compact = false,
  activeSection,
  interactionMode = "idle",
  children,
}: {
  className?: string;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  compact?: boolean;
  activeSection?: MascotSectionId;
  interactionMode?: MascotInteractionMode;
  children: ReactNode;
}) {
  return (
    <div
      ref={containerRef}
      data-mascot-section-active={activeSection}
      data-mascot-interaction={interactionMode}
      className={[
        "washero-mascot-float relative mx-auto aspect-square w-full",
        compact ? "max-w-[9rem]" : "max-w-[420px]",
        interactionMode !== "idle" ? "washero-mascot-float--engaged" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="Washero mascot"
    >
      <div className="washero-mascot-glow" aria-hidden />
      <div className="washero-mascot-card overflow-hidden">{children}</div>
    </div>
  );
}

function MascotPosterImage({ compact = false }: { compact?: boolean }) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return <MascotFallback compact={compact} />;
  }

  return (
    <img
      src={POSTER_SRC}
      alt="Mascota Washero"
      width={512}
      height={512}
      loading="lazy"
      decoding="async"
      onError={() => setHasError(true)}
      className={`block h-full w-full object-contain ${compact ? "p-2" : "p-4"}`}
    />
  );
}

function MascotPoster({
  className = "",
  compact = false,
  activeSection,
  interactionMode,
}: {
  className?: string;
  compact?: boolean;
  activeSection?: MascotSectionId;
  interactionMode?: MascotInteractionMode;
}) {
  return (
    <MascotShell
      className={className}
      compact={compact}
      activeSection={activeSection}
      interactionMode={interactionMode}
    >
      <MascotPosterImage compact={compact} />
    </MascotShell>
  );
}

function MascotViewer3D({
  className = "",
  compact = false,
  modelState = DEFAULT_MODEL_STATE,
  activeSection,
  interactionMode = "idle",
}: {
  className?: string;
  compact?: boolean;
  modelState?: MascotModelState;
  activeSection?: MascotSectionId;
  interactionMode?: MascotInteractionMode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ModelViewerEl>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [glbAnimations, setGlbAnimations] = useState<string[]>([]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    let cancelled = false;

    import("@google/model-viewer")
      .then(() => {
        if (!cancelled) setIsReady(true);
      })
      .catch(() => {
        if (!cancelled) setHasError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [isVisible]);

  useEffect(() => {
    const el = viewerRef.current;
    if (!el || !isReady) return;

    const onError = () => setHasError(true);
    const onLoad = () => {
      const names = el.availableAnimations ?? [];
      setGlbAnimations(names);
    };

    el.addEventListener("error", onError);
    el.addEventListener("load", onLoad);
    if (el.loaded) onLoad();

    return () => {
      el.removeEventListener("error", onError);
      el.removeEventListener("load", onLoad);
    };
  }, [isReady]);

  useEffect(() => {
    const el = viewerRef.current;
    if (!el || !isReady) return;

    const resolvedState: MascotModelState = {
      ...modelState,
      animationName:
        modelState.animationName && glbAnimations.includes(modelState.animationName)
          ? modelState.animationName
          : undefined,
    };

    applyModelState(el, resolvedState);
  }, [isReady, modelState, glbAnimations]);

  if (hasError) {
    return (
      <MascotShell className={className} compact={compact} activeSection={activeSection} interactionMode={interactionMode}>
        <MascotFallback compact={compact} />
      </MascotShell>
    );
  }

  const showViewer = isVisible && isReady;

  return (
    <MascotShell
      className={className}
      containerRef={containerRef}
      compact={compact}
      activeSection={activeSection}
      interactionMode={interactionMode}
    >
      {!showViewer ? <MascotPosterImage compact={compact} /> : null}

      {showViewer ? (
        <model-viewer
          ref={viewerRef}
          src={MODEL_SRC}
          poster={POSTER_SRC}
          alt="Mascota Washero"
          auto-rotate={modelState.autoRotate}
          auto-rotate-delay={modelState.autoRotateDelay}
          camera-orbit={modelState.cameraOrbit}
          shadow-intensity={modelState.shadowIntensity}
          exposure={modelState.exposure}
          environment-image="neutral"
          loading="lazy"
          interaction-prompt="none"
          disable-zoom
          disable-pan
          disable-tap
          rotation-per-second={modelState.rotationPerSecond}
          interpolation-decay="200"
          className="washero-mascot-viewer"
        />
      ) : null}
    </MascotShell>
  );
}

export function WasheroMascot3D({
  className = "",
  compact = false,
  modelState = DEFAULT_MODEL_STATE,
  activeSection,
  interactionMode = "idle",
}: {
  className?: string;
  compact?: boolean;
  modelState?: MascotModelState;
  activeSection?: MascotSectionId;
  interactionMode?: MascotInteractionMode;
}) {
  const isMobile = useIsMobile();
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!hasMounted) {
    return (
      <MascotPoster
        className={className}
        compact={compact}
        activeSection={activeSection}
        interactionMode={interactionMode}
      />
    );
  }

  if (isMobile) {
    return (
      <MascotPoster
        className={className}
        compact={compact}
        activeSection={activeSection}
        interactionMode={interactionMode}
      />
    );
  }

  return (
    <MascotViewer3D
      className={className}
      compact={compact}
      modelState={modelState}
      activeSection={activeSection}
      interactionMode={interactionMode}
    />
  );
}
