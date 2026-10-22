import * as t                 from 'typanion';

import { CaughtError }        from '../errors/caught-error';

import { AccumulatingLoader } from './config-accumulating-loader';

/**
 * How a Lambda reads its configuration from the environment. It collects every problem instead of stopping at the
 * first, so one failed start names all of them and a misconfigured deployment is fixed in one cycle. It never
 * throws during load; the entry point decides the failure policy.
 *
 * A variable that is missing, empty or whitespace-only is treated as not set: neither mandatory() nor optional()
 * hands such a string to a parser.
 */
export interface Loader {
  /** Reads a required variable; when it is not set, records a problem and returns the empty string. */
  mandatory(name: string): string;

  /** Reads an optional variable; when it is not set, returns the fallback and records nothing. */
  optional(name: string, fallback: string): string;

  /** Records a validation failure for a variable, such as a value that does not parse. */
  report(name: string, message: string): void;

  /** One message naming every recorded problem, or undefined when there are none. */
  error(): string | undefined;
}

/** The outcome of `tryLoad`: the loaded config beside the message naming every problem, if any. */
interface TryLoadResult<T> {
  config: T;
  error: string | undefined;
}

/** Validates a string of plain digits without a leading zero, such as `5`; zero, signs and fractions are rejected. */
export const isPositiveIntString = t.matchesRegExp(/^[1-9]\d*$/);

/**
 * Loads configuration and throws once, naming every problem, when any variable is missing or invalid.
 */
export function mustLoad<T>(load: (l: Loader) => T): T {
  const loader = new AccumulatingLoader();
  const result = load(loader);
  loader.throwIfInvalid();
  return result;
}

/**
 * Loads configuration without throwing: returns the config together with the message naming every problem,
 * so the caller decides whether to fail.
 */
export function tryLoad<T>(load: (l: Loader) => T): TryLoadResult<T> {
  const loader = new AccumulatingLoader();
  const config = load(loader);
  return { config, error: loader.error() };
}

/**
 * Returns a check for `withSmokeTest` that loads the configuration and throws, naming every problem, when it is invalid.
 */
export function check<T>(load: (l: Loader) => T): () => void {
  return () => {
    const loader = new AccumulatingLoader();
    load(loader);
    loader.throwIfInvalid();
  };
}

/**
 * Reads a mandatory variable and parses it. A missing variable or a parse failure is recorded and `whenInvalid`
 * is returned.
 *
 * `whenInvalid` is required because TypeScript has no zero value for a generic type. It is never used once a
 * problem is recorded: `mustLoad` throws, `tryLoad` hands the problem to the caller and `check` throws.
 */
export function mandatoryAs<T>(l: Loader, name: string, parse: (raw: string) => T, whenInvalid: T): T {
  const raw = l.mandatory(name);
  if (!raw) {
    return whenInvalid;
  }
  return parseOrReport(l, name, raw, parse, whenInvalid);
}

/**
 * Reads an optional variable and parses it. When it is not set, returns the fallback and records nothing; when
 * it is set but does not parse, records the failure and returns the fallback.
 */
export function optionalAs<T>(l: Loader, name: string, fallback: T, parse: (raw: string) => T): T {
  const raw = l.optional(name, '');
  if (!raw) {
    return fallback;
  }
  return parseOrReport(l, name, raw, parse, fallback);
}

/** Stock parser: JSON text validated by a typanion validator; throws when the text is not JSON or fails the validator. */
export function json<T>(validator: t.StrictValidator<unknown, T>): (raw: string) => T {
  return (raw: string): T => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (failure) {
      throw new Error(`invalid JSON: ${new CaughtError(failure).message ?? String(failure)}`);
    }

    const errors: string[] = [];
    if (!validator(parsed, { errors })) {
      throw new Error(`schema validation failed: ${errors.join('; ')}`);
    }
    return parsed;
  };
}

/** Stock parser: comma-separated list with each element trimmed; throws on an empty list or an empty element. */
export function commaList(raw: string): string[] {
  const elements = raw.split(',').map((element) => element.trim());
  if (elements.some((element) => !element)) {
    throw new Error(`expected comma-separated list, got "${raw}"`);
  }
  return elements;
}

/** Stock parser: positive integer; throws on zero, negatives, fractions and anything that is not plain digits. */
export function positiveInt(raw: string): number {
  const trimmed = raw.trim();
  if (!isPositiveIntString(trimmed)) {
    throw new Error(`expected positive integer, got "${raw}"`);
  }
  return parseInt(trimmed, 10);
}

/** Stock parser: a positive number of days, returned in milliseconds. */
export function days(raw: string): number {
  return positiveInt(raw) * 24 * 60 * 60 * 1000;
}

/** Stock parser: exactly `on` or `off`, case-sensitive; every other value, such as `true` or `1`, throws. */
export function onOff(raw: string): boolean {
  if (raw === 'on') {
    return true;
  }
  if (raw === 'off') {
    return false;
  }
  throw new Error(`expected 'on' or 'off', got "${raw}"`);
}

/** Stock parser: one of the allowed values, case-sensitive, typed as the union of the allowed values. */
export function enumOf<T extends string>(...allowed: T[]): (raw: string) => T {
  return (raw: string): T => {
    const match = allowed.find((a) => a === raw);
    if (match === undefined) {
      throw new Error(`expected one of [${allowed.join(', ')}], got "${raw}"`);
    }
    return match;
  };
}

/** Parses the raw value; on failure records the parse error against the variable and returns `whenInvalid`. */
function parseOrReport<T>(l: Loader, name: string, raw: string, parse: (raw: string) => T, whenInvalid: T): T {
  try {
    return parse(raw);
  } catch (failure) {
    l.report(name, new CaughtError(failure).message ?? String(failure));
    return whenInvalid;
  }
}
