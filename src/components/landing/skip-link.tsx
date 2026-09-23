/** Keyboard skip link; visually hidden until focused. */
export function SkipLink({
  targetId,
  label = "Skip to content",
}: {
  targetId: string;
  label?: string;
}) {
  return (
    <a
      href={`#${targetId}`}
      className="bg-signal text-void sr-only rounded-lg px-4 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-4 focus:z-50"
    >
      {label}
    </a>
  );
}
