import { loadLimits, type AnalysisLimits } from "@/lib/config/limits";

/**
 * Analysis limits of this server process, read from the environment once:
 * configuration does not change at runtime, and `loadLimits` warns about
 * invalid values, which should happen once rather than per request.
 */

let memo: AnalysisLimits | null = null;

export function getServerLimits(): AnalysisLimits {
  memo ??= loadLimits();
  return memo;
}
