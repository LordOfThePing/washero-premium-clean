import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

const MODEL_SRC = "/models/washero-mascot.optimized.glb";
const POSTER_SRC = "/models/washero-mascot-poster.webp";

function MascotFallback({ compact }: { compact?: boolean }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 text-neutral-400 ${compact ? "py-6" : "py-10"}`}
      aria-hidden
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/5">
        <Sparkles className="h-6 w-6 text-primary/80" />
      </div>
      <span className="text-xs tracking-wide text-neutral-500">Washero</span>
    </div>
  );
}

function MascotShell({
  className = "",
  containerRef,
  children,
}: {
  className?: string;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  return (
    <div
      ref={containerRef}
      className={`washero-mascot-float relative mx-auto aspect-square w-full max-w-[220px] md:max-w-[26rem] ${className}`}
      aria-label="Washero mascot"
    >
      <div className="washero-mascot-glow" aria-hidden />
      <div className="washero-mascot-card absolute inset-0 overflow-hidden">{children}</div>
    </div>
  );
}

function MascotPosterImage({ hidden }: { hidden?: boolean }) {
  return (
    <img
      src={POSTER_SRC}
      alt="Mascota Washero"
      width={512}
      height={512}
      loading="lazy"
      decoding="async"
      className={`h-full w-full object-contain p-4 transition-opacity duration-700 ${
        hidden ? "pointer-events-none absolute inset-0 opacity-0" : "opacity-100"
      }`}
    />
  );
}

function MascotPoster({ className = "" }: { className?: string }) {
  return (
    <MascotShell className={className}>
      <MascotPosterImage />
    </MascotShell>
  );
}

function MascotViewer3D({ className = "" }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

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

    const onLoad = () => setIsLoaded(true);
    const onError = () => setHasError(true);

    el.addEventListener("load", onLoad);
    el.addEventListener("error", onError);

    return () => {
      el.removeEventListener("load", onLoad);
      el.removeEventListener("error", onError);
    };
  }, [isReady]);

  if (hasError) {
    return <MascotPoster className={className} />;
  }

  const showViewer = isVisible && isReady;

  return (
    <MascotShell className={className} containerRef={containerRef}>
      {!showViewer ? <MascotPosterImage /> : null}

      {showViewer && !isLoaded ? <MascotFallback compact /> : null}

      {showViewer ? (
        <>
          <MascotPosterImage hidden={isLoaded} />
          <model-viewer
            ref={viewerRef}
            src={MODEL_SRC}
            poster={POSTER_SRC}
            alt="Mascota Washero"
            auto-rotate
            shadow-intensity="0.85"
            exposure="1.05"
            environment-image="neutral"
            loading="lazy"
            interaction-prompt="none"
            disable-zoom
            disable-pan
            disable-tap
            rotation-per-second="12deg"
            className={`washero-mascot-viewer absolute inset-0 h-full w-full transition-opacity duration-700 ${
              isLoaded ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          />
        </>
      ) : null}
    </MascotShell>
  );
}

export function WasheroMascot3D({ className = "" }: { className?: string }) {
  const isMobile = useIsMobile();
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!hasMounted || isMobile) {
    return <MascotPoster className={className} />;
  }

  return <MascotViewer3D className={className} />;
}
