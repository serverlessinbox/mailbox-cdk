/**
 * Environment variable helpers matching Go's `env` package semantics.
 *
 * Like Go's env.Get() and env.MustGet(), treats empty-string values as absent
 * (unlike JavaScript's `??` operator, which only treats null/undefined as falsy).
 * This ensures consistency with Go semantics across the codebase.
 */

/**
 * Read a required environment variable.
 * Throws if the variable is not set or is an empty string.
 *
 * Go equivalent: env.MustGet(name)
 */
export function mustGet(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`required environment variable ${name} is not set`);
  }
  return value;
}

// Overloaded signatures for get() to preserve type safety:
// - get(name) returns string | undefined (no fallback)
// - get(name, fallback: string) returns string (always has a value)
// - get(name, fallback: undefined) returns string | undefined (equivalent to no fallback)

/**
 * Read an optional environment variable with a fallback.
 * Treats empty-string values as absent, returning the fallback instead.
 *
 * Go equivalent: env.Get(name, fallback)
 */
export function get(name: string): string | undefined;
export function get(name: string, fallback: string): string;
export function get(name: string, fallback: undefined): string | undefined;
export function get(name: string, fallback: string | undefined = undefined): string | undefined {
  const value = process.env[name];
  // Treat empty string as absent, matching Go semantics
  if (value === '' || value === undefined) {
    return fallback;
  }
  return value;
}
