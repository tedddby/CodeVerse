"use client";

import { LoaderCircle, MonitorX, TriangleAlert } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { detectWebGL } from "@/lib/webgl";
import { DemoErrorBoundary } from "./demo-error-boundary";

// three.js, the engine and the demo fixture live in this chunk; it is requested
// only once the demo scrolls near the viewport.
const DemoWorld = dynamic(() => import("./demo-world"), { ssr: false, loading: () => null });

export type DemoStatus = "idle" | "loading" | "ready" | "unsupported" | "failed";

/** Give up (and keep the poster) if the world has not drawn by then. */
const START_TIMEOUT_MS = 20_000;
/** Start loading slightly before the demo enters the viewport. */
const PRELOAD_MARGIN = "240px 0px";

export interface InteractiveDemoProps {
  /** Static render shown until the 3D world is ready, and whenever it cannot start. */
  poster: ReactNode;
  /** Visible label identifying the demo data, e.g. "Demo repository · owner/name". */
  label: string;
  className?: string;
}

const STATUS_COPY: Partial<Record<DemoStatus, { icon: ReactNode; text: string }>> = {
  loading: {
    icon: <LoaderCircle aria-hidden="true" className="text-signal size-3.5 animate-spin" />,
    text: "Starting the 3D engine…",
  },
  unsupported: {
    icon: <MonitorX aria-hidden="true" className="text-warn size-3.5" />,
    text: "WebGL isn't available in this browser, so this is a static render of the same world.",
  },
  failed: {
    icon: <TriangleAlert aria-hidden="true" className="text-warn size-3.5" />,
    text: "The 3D preview couldn't start, so this is a static render of the same world.",
  },
};

/**
 * Lazy frame for the live 3D demo. Renders the server-made poster immediately,
 * starts WebGL only when the frame approaches the viewport (and only if WebGL
 * exists), then cross-fades to the live world once it has drawn.
 */
export function InteractiveDemo({ poster, label, className }: InteractiveDemoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activatedRef = useRef(false);
  const [status, setStatus] = useState<DemoStatus>("idle");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const activate = () => {
      if (activatedRef.current) return;
      activatedRef.current = true;
      setStatus(detectWebGL() ? "loading" : "unsupported");
    };
    if (typeof IntersectionObserver === "undefined") {
      const frame = requestAnimationFrame(() => {
        setVisible(true);
        activate();
      });
      return () => cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const intersecting = entries.some((entry) => entry.isIntersecting);
        setVisible(intersecting);
        if (intersecting) activate();
      },
      { rootMargin: PRELOAD_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (status !== "loading") return;
    const timeout = window.setTimeout(() => {
      setStatus((current) => (current === "loading" ? "failed" : current));
    }, START_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [status]);

  const handleReady = useCallback(() => {
    setStatus((current) => (current === "loading" ? "ready" : current));
  }, []);
  const handleError = useCallback(() => setStatus("failed"), []);

  const ready = status === "ready";
  const running = status === "loading" || ready;
  const note = STATUS_COPY[status];

  return (
    <div
      ref={containerRef}
      data-demo-status={status}
      className={cn(
        "border-line bg-abyss relative isolate overflow-hidden rounded-2xl border",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_72%)] opacity-50"
      />
      <div
        aria-hidden={ready ? true : undefined}
        className={cn(
          "absolute inset-0 flex items-center justify-center px-4 pt-14 pb-14 transition-opacity duration-700 sm:px-10",
          ready && "pointer-events-none opacity-0",
        )}
      >
        {poster}
      </div>

      {running ? (
        <DemoErrorBoundary onError={handleError}>
          <div
            className={cn(
              "absolute inset-0 transition-opacity duration-700",
              ready ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <DemoWorld visible={visible} onReady={handleReady} onError={handleError} />
          </div>
        </DemoErrorBoundary>
      ) : null}

      <p className="text-ink-muted glass pointer-events-none absolute top-3 left-3 z-20 flex max-w-[calc(100%-7.5rem)] items-center gap-2 rounded-lg px-2.5 py-1.5 font-mono text-[11px]">
        <span aria-hidden="true" className="bg-signal size-1.5 shrink-0 rounded-full" />
        <span className="truncate">{label}</span>
      </p>

      <div
        role="status"
        className={cn(
          "absolute right-3 bottom-3 left-3 z-20 sm:right-auto sm:max-w-md",
          !note && "sr-only",
        )}
      >
        {note ? (
          <p className="glass text-ink-muted flex items-start gap-2 rounded-lg px-3 py-2 text-xs">
            <span className="mt-px shrink-0">{note.icon}</span>
            <span>{note.text}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
