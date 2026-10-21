import type { Loader } from './config-env';

/**
 * The single place the environment is read for configuration. It treats a blank variable as missing and keeps every
 * problem it meets, so a Lambda cannot start half-configured and the person fixing it sees all problems at once.
 * What happens to the collected problems is decided by the caller, not by this class.
 */
export class AccumulatingLoader implements Loader {
  private readonly problems: string[] = [];

  public mandatory(name: string): string {
    const value = this.readPresent(name);
    if (value === undefined) {
      this.problems.push(`${name} is not set`);
      return '';
    }
    return value;
  }

  public optional(name: string, fallback: string): string {
    return this.readPresent(name) ?? fallback;
  }

  public report(name: string, message: string): void {
    this.problems.push(`${name}: ${message}`);
  }

  public error(): string | undefined {
    return this.problems.length === 0 ? undefined : this.problems.join('; ');
  }

  /** Throws one error naming every collected problem; does nothing when there are none. */
  public throwIfInvalid(): void {
    const problems = this.error();
    if (problems) {
      throw new Error(`config validation failed: ${problems}`);
    }
  }

  /** The variable's value, or undefined when it is unset, empty or whitespace-only. */
  private readPresent(name: string): string | undefined {
    const value = process.env[name];
    return value === undefined || !value.trim() ? undefined : value;
  }
}
