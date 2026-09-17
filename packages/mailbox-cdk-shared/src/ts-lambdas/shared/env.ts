/**
 * Environment variable helpers matching Go's `env` package semantics.
 *
 * Like Go's env.Get() and env.MustGet(), treats empty-string and whitespace-only values as absent
 * (unlike JavaScript's `??` operator, which only treats null/undefined as falsy).
 * This ensures consistency with Go semantics across the codebase.
 */

import * as t from 'typanion';

/**
 * Accumulating config loader — validates environment variables and collects problems.
 * Never throws during load; entry-point wrappers decide failure policy.
 *
 * Uniform empty rule: a variable that is missing, empty, or whitespace-only is treated as not set.
 * Neither mandatory() nor optional() will hand an empty or whitespace-only string to a parser.
 */
export interface Loader {
  /**
   * Read a required environment variable.
   * If unset, empty, or whitespace-only, records a problem and returns empty string.
   */
  mandatory(name: string): string;

  /**
   * Read an optional environment variable with a fallback.
   * If unset, empty, or whitespace-only, returns fallback (records nothing).
   * If present and non-empty, the caller must parse and report via report() on failure.
   */
  optional(name: string, fallback: string): string;

  /**
   * Record a validation failure for a variable (e.g. a parse error).
   * The message describes what went wrong; the loader collects it.
   */
  report(name: string, message: string): void;

  /**
   * Get the accumulated error message.
   * Returns undefined if no problems were recorded; otherwise a single message naming every problem.
   */
  error(): string | undefined;
}

/**
 * Create an accumulating loader instance.
 */
function createLoader(): Loader {
  const problems: string[] = [];

  return {
    mandatory(name: string): string {
      const value = process.env[name];
      if (!value || !value.trim()) {
        problems.push(`${name} is not set`);
        return '';
      }
      return value;
    },

    optional(name: string, fallback: string): string {
      const value = process.env[name];
      if (!value || !value.trim()) {
        return fallback;
      }
      return value;
    },

    report(name: string, message: string): void {
      problems.push(`${name}: ${message}`);
    },

    error(): string | undefined {
      return problems.length === 0 ? undefined : problems.join('; ');
    },
  };
}

/**
 * Load configuration with mandatory failure policy.
 * Accumulates all problems, then throws ONCE with a message naming every problem.
 *
 * Use for: normal Lambda handlers that should fail fast if config is incomplete.
 */
export function mustLoad<T>(load: (l: Loader) => T): T {
  const loader = createLoader();
  const result = load(loader);
  const err = loader.error();
  if (err) {
    throw new Error(`config validation failed: ${err}`);
  }
  return result;
}

/**
 * Load configuration with non-throwing policy.
 * Accumulates all problems and returns them alongside the result.
 * Caller decides whether to fail the invocation.
 *
 * Use for: CloudFormation custom-resource handlers that must return a response object,
 * which can include a failure status and error message.
 */
export function tryLoad<T>(
  load: (l: Loader) => T,
): { config: T; error: string | undefined } {
  const loader = createLoader();
  const config = load(loader);
  const error = loader.error();
  return { config, error };
}

/**
 * Load configuration for a smoke test.
 * Returns a check function that can be registered with withSmokeTest.
 * The check throws if config validation fails.
 *
 * Use for: registering config checks with withSmokeTest's optional checks parameter.
 */
export function check<T>(load: (l: Loader) => T): () => void {
  return () => {
    const loader = createLoader();
    load(loader);
    const err = loader.error();
    if (err) {
      throw new Error(`config validation failed: ${err}`);
    }
  };
}

/**
 * Typed accessor for mandatory variables.
 * If absent: records a problem and returns whenInvalid.
 * If present but parse throws: records the error and returns whenInvalid.
 *
 * The whenInvalid parameter is required because TypeScript has no zero value for a generic type T.
 * This value is never used in production: when a problem has been recorded, mustLoad throws,
 * tryLoad discards the config in favour of the FAILED response, and check throws. The parameter
 * exists only so the function is type-honest and cannot silently hand a string to a field typed number.
 */
export function mandatoryAs<T>(l: Loader, name: string, parse: (raw: string) => T, whenInvalid: T): T {
  const raw = l.mandatory(name);
  if (!raw) {
    // If mandatory() already failed, return the provided fallback.
    return whenInvalid;
  }
  try {
    return parse(raw);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    l.report(name, message);
    return whenInvalid;
  }
}

/**
 * Typed accessor for optional variables.
 * If absent: returns fallback (records nothing).
 * If present but parse throws: records the error AND returns fallback.
 * Malformed optional values are always reported (the owner's explicit requirement).
 */
export function optionalAs<T>(l: Loader, name: string, fallback: T, parse: (raw: string) => T): T {
  const raw = l.optional(name, '');
  if (!raw) {
    return fallback;
  }
  try {
    return parse(raw);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    l.report(name, message);
    return fallback;
  }
}

/**
 * Stock parser: parses JSON using a typanion validator.
 * The validator function should return true if valid, false otherwise.
 * Throws if JSON parsing or schema validation fails.
 */
export function json<T>(validator: (value: unknown, opts?: { errors?: string[] }) => value is T): (raw: string) => T {
  return (raw: string): T => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }

    const errors: string[] = [];
    if (!validator(parsed, { errors })) {
      throw new Error(`schema validation failed: ${errors.join('; ')}`);
    }
    return parsed as T;
  };
}

/**
 * Stock parser: comma-separated list of strings.
 * Trims whitespace from each element.
 * Throws if input is empty, whitespace-only, or contains any empty element after trimming.
 */
export function commaList(raw: string): string[] {
  if (!raw || !raw.trim()) {
    throw new Error(`expected comma-separated list, got "${raw}"`);
  }
  const elements = raw.split(',').map((s) => s.trim());
  for (const elem of elements) {
    if (!elem) {
      throw new Error(`expected comma-separated list, got "${raw}"`);
    }
  }
  return elements;
}

/**
 * Stock parser: positive integer.
 * Throws if value is not a positive integer.
 */
const isPositiveIntString = t.cascade(
  t.isString(),
  [
    t.matchesRegExp(/^[1-9]\d*$/),
  ]
);

export function positiveInt(raw: string): number {
  const trimmed = raw.trim();

  const errors: string[] = [];
  if (!isPositiveIntString(trimmed, { errors })) {
    throw new Error(`expected positive integer, got "${raw}"`);
  }

  return parseInt(trimmed, 10);
}

/**
 * Stock parser: days to milliseconds.
 * Accepts a positive integer representing days.
 * Returns the value in milliseconds.
 */
export function days(raw: string): number {
  const dayCount = positiveInt(raw);
  return dayCount * 24 * 60 * 60 * 1000;
}

/**
 * Stock parser: on/off switch.
 * Accepts EXACTLY 'on' or 'off' (case-sensitive).
 * Rejects '', 'true', '1', 'false', '0', etc.
 */
export function onOff(raw: string): boolean {
  if (raw === 'on') return true;
  if (raw === 'off') return false;
  throw new Error(`expected 'on' or 'off', got "${raw}"`);
}

/**
 * Stock parser: enum values.
 * Accepts one of the allowed values (case-sensitive).
 * Preserves the logical type: enumOf('off', 'on', 'forced') returns a parser yielding 'off' | 'on' | 'forced'.
 */
export function enumOf<T extends string>(...allowed: T[]): (raw: string) => T {
  return (raw: string): T => {
    const match = allowed.find((a) => a === raw);
    if (match === undefined) {
      throw new Error(`expected one of [${allowed.join(', ')}], got "${raw}"`);
    }
    return match;
  };
}
