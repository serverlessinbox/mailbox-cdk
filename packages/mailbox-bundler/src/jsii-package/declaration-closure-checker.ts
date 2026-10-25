import { access, readFile }                            from 'fs/promises';
import { glob }                                        from 'glob';
import { isBuiltin }                                   from 'module';
import { dirname, join, relative, resolve }            from 'path';

import { findReferencePaths, findSpecifierReferences } from './declaration-references';
import { readPackageJson }                             from './package-json';

const declarationsFolderName = 'lib';
const declarationSuffix      = '.d.ts';

/** What one walk over the declaration closure found: the files it reached and the violations in them. */
interface ClosureWalk {
  readonly reached:    Set<string>;
  readonly violations: string[];
  readonly allowed:    Set<string>;
}

/**
 * Checks that the declarations a published package ships name only packages its consumers get
 * installed. The closure starts at the entry named by `publishConfig.types` and follows every
 * relative import and `reference path`; a bare import in it must name a dependency, a peer
 * dependency or a Node built-in. Declaration files the closure does not reach are not violations,
 * but they ship, so they are counted separately.
 */
export class DeclarationClosureChecker {
  constructor(private readonly packageFolder: string) {}

  /**
   * One message per violation, naming the declaration file and the specifier. Rejects when
   * package.json has no `publishConfig.types` or the entry declaration file cannot be read.
   */
  public async check(): Promise<string[]> {
    const walk = await this.walkClosure();
    return walk.violations;
  }

  /** The number of declaration files in `lib/` outside the closure that name an undeclared package. */
  public async countUndeclaredOutsideClosure(): Promise<number> {
    const walk  = await this.walkClosure();
    const files = await glob(join(this.packageFolder, declarationsFolderName, '**', `*${declarationSuffix}`));

    let count = 0;
    for (const file of files.filter(candidate => !walk.reached.has(candidate))) {
      const content = await readFile(file, 'utf-8');
      if (findSpecifierReferences(content).some(reference => this.isUndeclared(reference.specifier, walk.allowed))) {
        count++;
      }
    }
    return count;
  }

  private async walkClosure(): Promise<ClosureWalk> {
    const manifest = await readPackageJson(this.packageFolder);
    const types    = manifest.publishConfig?.types;
    if (types === undefined) {
      throw new Error(`${join(this.packageFolder, 'package.json')} has no publishConfig.types to start the declaration closure from`);
    }
    const allowed     = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]);
    const packageName = manifest.name ?? this.packageFolder;

    const files                = [resolve(this.packageFolder, types)];
    const reached              = new Set(files);
    const violations: string[] = [];

    // The list grows while it is walked: each file a relative specifier reaches is walked in turn.
    for (const file of files) {
      const content    = await readFile(file, 'utf-8');
      const specifiers = [
        ...findSpecifierReferences(content).map(reference => reference.specifier),
        ...findReferencePaths(content),
      ];

      for (const specifier of specifiers) {
        if (specifier.startsWith('.')) {
          const target = await this.resolveRelativeDeclaration(file, specifier);
          if (target === undefined) {
            violations.push(`${this.display(file)} imports '${specifier}', which has no declaration file`);
          } else if (!reached.has(target)) {
            reached.add(target);
            files.push(target);
          }
        } else if (this.isUndeclared(specifier, allowed)) {
          violations.push(`${this.display(file)} imports '${specifier}', which is neither a dependency nor a peer dependency of ${packageName}`);
        }
      }
    }
    return { reached, violations, allowed };
  }

  private isUndeclared(specifier: string, allowed: Set<string>): boolean {
    return !specifier.startsWith('.') && !isBuiltin(specifier) && !allowed.has(this.packageNameOf(specifier));
  }

  /** `@scope/name/sub` is `@scope/name`; `name/sub` is `name`. */
  private packageNameOf(specifier: string): string {
    const segments = specifier.split('/');
    return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
  }

  private async resolveRelativeDeclaration(file: string, specifier: string): Promise<string | undefined> {
    const base       = join(dirname(file), specifier);
    const candidates = [`${base}${declarationSuffix}`, join(base, `index${declarationSuffix}`)];
    if (base.endsWith(declarationSuffix)) {
      candidates.unshift(base);
    }
    for (const candidate of candidates) {
      if (await this.exists(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private display(file: string): string {
    return relative(this.packageFolder, file);
  }
}
