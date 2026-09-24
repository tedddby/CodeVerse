import { cn } from "@/lib/utils/cn";
import styles from "./landing.module.css";

/**
 * The aurora mesh behind the hero and the closing band: five soft color washes
 * drifting on the compositor (transform only), over a violet base. Cyan and
 * amber sit low, at the "horizon"; text only ever sits on the deep upper half.
 * Decorative; animation stops under prefers-reduced-motion.
 */
export function GradientField({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn(styles.field, className)}>
      <div className={cn(styles.wash, styles.washViolet)} />
      <div className={cn(styles.wash, styles.washMagenta)} />
      <div className={cn(styles.wash, styles.washCyan)} />
      <div className={cn(styles.wash, styles.washAmber)} />
      <div className={cn(styles.wash, styles.washIndigo)} />
      <div className={styles.shade} />
    </div>
  );
}
