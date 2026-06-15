import type { ModelViewerElement } from "@google/model-viewer";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<
        React.HTMLAttributes<ModelViewerElement> & {
          src?: string;
          alt?: string;
          poster?: string;
          "auto-rotate"?: boolean;
          "auto-rotate-delay"?: number;
          "camera-orbit"?: string;
          "camera-controls"?: boolean;
          "interpolation-decay"?: string | number;
          "shadow-intensity"?: string | number;
          exposure?: string | number;
          "environment-image"?: string;
          loading?: "auto" | "lazy" | "eager";
          "interaction-prompt"?: "auto" | "when-focused" | "none";
          "disable-zoom"?: boolean;
          "disable-pan"?: boolean;
          "disable-tap"?: boolean;
          "rotation-per-second"?: string;
        },
        ModelViewerElement
      >;
    }
  }
}

export {};
