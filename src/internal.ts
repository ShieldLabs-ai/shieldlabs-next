/** The message of an error, or the value as text when something other than an Error was thrown. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
