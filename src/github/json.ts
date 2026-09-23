import type { z } from "zod";
import { invalidResponse } from "./errors";

/**
 * JSON parsing + Zod validation for provider payloads. Failures become
 * `SourceError("INVALID_RESPONSE")`; messages name the offending schema path
 * (keys and indices only, never payload values).
 */

function describeZodFailure(error: z.ZodError): string {
  const issue = error.issues[0];
  const where = issue && issue.path.length > 0 ? ` at "${issue.path.map(String).join(".")}"` : "";
  return `GitHub returned data in an unexpected shape${where}.`;
}

/** Validates already-parsed data. */
export function validateWith<T>(schema: z.ZodType<T>, data: unknown, status?: number): T {
  const result = schema.safeParse(data);
  if (!result.success) throw invalidResponse(describeZodFailure(result.error), status);
  return result.data;
}

/** Parses a JSON body (`null` stands for an empty 204 answer) and validates it. */
export function parseJsonBody<T>(bodyText: string | null, schema: z.ZodType<T>): T {
  let data: unknown = null;
  if (bodyText !== null) {
    try {
      data = JSON.parse(bodyText);
    } catch {
      throw invalidResponse("GitHub returned malformed JSON.");
    }
  }
  return validateWith(schema, data);
}
