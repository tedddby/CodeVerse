"use client";

import { Canvas, type RootState } from "@react-three/fiber";
import {
  Component,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
  type RefObject,
} from "react";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";
import { cn } from "@/lib/utils/cn";
import { useExplorerStore } from "@/state/explorer-store";
import { UniverseScene } from "./universe-scene";

/**
 * The 3D universe: renders the store's `WorldLayout` as a city (districts,
 * buildings, labels, symbol bands, dependency arcs) and owns the camera.
 *
 * Load it client-side only (`next/dynamic` with `ssr: false`). Works both as
 * the full explorer view and as a small, non-interactive preview.
 */
export interface UniverseCanvasProps {
  className?: string;
  /**
   * Default true. false = non-interactive preview (landing page, loading
   * backdrop): no picking, no camera input, no keyboard, no pose reporting.
   */
  interactive?: boolean;
  /** Slow orbit around the world centre; pauses while the user interacts. */
  autoRotate?: boolean;
}

/** Initial camera before the rig frames anything (the rig takes over on mount). */
const INITIAL_CAMERA = {
  fov: 45,
  near: 0.1,
  far: 5_000,
  position: [120, 100, 120] as [number, number, number],
};

function configureRenderer({ gl }: RootState): void {
  // Filmic tone mapping into sRGB; exposure tuned for the scene's analytic lighting.
  gl.toneMapping = ACESFilmicToneMapping;
  gl.toneMappingExposure = 1.1;
  gl.outputColorSpace = SRGBColorSpace;
  // A context exists: let the rest of the UI know WebGL works here.
  const store = useExplorerStore.getState();
  if (store.webglAvailable !== true) store.setWebglAvailable(true);
}

function deselectOnEmptyClick(event: MouseEvent): void {
  // R3F only reports misses for clicks that were not drags.
  if (event.type === "click") useExplorerStore.getState().select(null);
}

export default function UniverseCanvas({
  className,
  interactive = true,
  autoRotate = false,
}: UniverseCanvasProps) {
  const webglAvailable = useExplorerStore((state) => state.webglAvailable);
  const repositoryName = useExplorerStore((state) => state.graph?.repository.fullName ?? null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(containerRef);

  const label = repositoryName
    ? `3D map of ${repositoryName}: directories as districts, files as buildings`
    : "3D code universe";

  return (
    <div
      ref={containerRef}
      className={cn(
        "bg-void relative h-full w-full overflow-hidden",
        !interactive && "pointer-events-none",
        className,
      )}
    >
      {webglAvailable === false ? (
        <RendererUnavailable />
      ) : (
        <CanvasErrorBoundary>
          <Canvas
            role="img"
            aria-label={label}
            dpr={[1, 2]}
            gl={{
              antialias: true,
              alpha: false,
              stencil: false,
              powerPreference: "high-performance",
            }}
            camera={INITIAL_CAMERA}
            // Offscreen canvases (e.g. a scrolled-away landing demo) stop rendering entirely.
            frameloop={onScreen ? "always" : "never"}
            onCreated={configureRenderer}
            onPointerMissed={interactive ? deselectOnEmptyClick : undefined}
          >
            <UniverseScene interactive={interactive} autoRotate={autoRotate} />
          </Canvas>
        </CanvasErrorBoundary>
      )}
    </div>
  );
}

/** Tracks whether an element intersects the viewport (true when IntersectionObserver is unavailable). */
function useOnScreen(ref: RefObject<HTMLElement | null>): boolean {
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setOnScreen(entry.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return onScreen;
}

function RendererUnavailable() {
  return (
    <div
      role="status"
      className="absolute inset-0 flex items-center justify-center p-6 text-center"
    >
      <div className="max-w-sm space-y-1.5">
        <p className="text-ink text-sm font-medium">3D view unavailable</p>
        <p className="text-ink-muted text-xs leading-relaxed">
          WebGL could not be started in this browser, so the city cannot be drawn. Enable hardware
          acceleration or try another browser.
        </p>
      </div>
    </div>
  );
}

function RendererCrashed({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="absolute inset-0 flex items-center justify-center p-6 text-center">
      <div className="max-w-sm space-y-3">
        <div className="space-y-1.5">
          <p className="text-ink text-sm font-medium">The 3D view stopped</p>
          <p className="text-ink-muted text-xs leading-relaxed">
            Something went wrong while drawing the city. Panels and search still work.
          </p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="border-line-strong bg-panel-raised text-ink hover:border-signal/60 hover:text-signal rounded-md border px-3 py-1.5 text-xs transition-colors"
        >
          Reload 3D view
        </button>
      </div>
    </div>
  );
}

/** WebGL context creation failures from three.js / R3F mention "WebGL" in their message. */
function isWebglUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /webgl/i.test(message);
}

type BoundaryState = { failure: null | "webgl" | "crash" };

/**
 * Catches renderer failures. A WebGL context that cannot be created marks
 * WebGL as unavailable in the store; any other crash offers a retry.
 */
class CanvasErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { failure: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { failure: isWebglUnavailableError(error) ? "webgl" : "crash" };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("CodeVerse: the 3D renderer failed", error, info.componentStack);
    if (isWebglUnavailableError(error)) useExplorerStore.getState().setWebglAvailable(false);
  }

  private readonly retry = () => this.setState({ failure: null });

  override render(): ReactNode {
    if (this.state.failure === "webgl") return <RendererUnavailable />;
    if (this.state.failure === "crash") return <RendererCrashed onRetry={this.retry} />;
    return this.props.children;
  }
}
