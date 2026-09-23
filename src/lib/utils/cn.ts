type ClassValue = string | false | null | undefined | 0;

/** Joins truthy class names. Tailwind conflicts are resolved by ordering, not merging. */
export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(" ");
}
