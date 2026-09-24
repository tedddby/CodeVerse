/** Keyboard skip link; visually hidden until focused. */
export function SkipLink({ targetId }: { targetId: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only rounded-full bg-(--lc-ink) px-4 py-2.5 text-sm font-semibold text-white shadow-lg focus:not-sr-only focus:fixed focus:top-3 focus:left-4 focus:z-50"
    >
      Skip to content
    </a>
  );
}
