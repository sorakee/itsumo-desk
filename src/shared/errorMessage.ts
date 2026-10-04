/** A readable message for an error of unknown type. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
