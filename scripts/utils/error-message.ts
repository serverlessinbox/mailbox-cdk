/** The message of a caught value: an `Error`'s message, otherwise the value in string form. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
