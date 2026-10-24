// Matches a file path against repo-relative paths. A `*` in a path stays within one path segment.
export class AllowListMatcher {
  private readonly patterns: readonly RegExp[];

  public constructor(paths: readonly string[]) {
    this.patterns = paths.map((path) => this.toPattern(path));
  }

  public matches(filename: string): boolean {
    const normalized = filename.replace(/\\/g, '/');

    return this.patterns.some((pattern) => pattern.test(normalized));
  }

  private toPattern(path: string): RegExp {
    const escaped = path.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');

    return new RegExp(`(^|/)${escaped}$`);
  }
}
