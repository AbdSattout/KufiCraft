import { ConvexError } from "convex/values";

/**
 * Backend failures are thrown as `ConvexError` with an Arabic user-facing
 * message in `data` (see docs/BACKEND.md); anything else falls back to the
 * caller's generic Arabic message.
 */
export function mutationErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (
    error instanceof ConvexError &&
    typeof error.data === "string" &&
    error.data.length > 0
  ) {
    return error.data;
  }
  return fallback;
}
