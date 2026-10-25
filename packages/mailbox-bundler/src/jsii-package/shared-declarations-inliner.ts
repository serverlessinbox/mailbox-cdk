import { access, mkdir, mkdtemp, readFile, rm, writeFile }  from 'fs/promises';
import { glob }                                             from 'glob';
import { createRequire }                                    from 'module';
import { tmpdir }                                           from 'os';
import { dirname, join, relative, sep }                     from 'path';

import { runWithInheritedStdio }                            from '../utils/run-process';

import { readPackageJson }                                  from './package-json';

const declarationsFolderName = 'lib';
const declarationSuffix      = '.d.ts';
const testFoldersGlob        = 'lib/**/__tests__/**';

/**
 * Finds module specifiers in emitted declarations: `from 'x'`, `import 'x'`, `import('x')` and
 * `require('x')`. The lookbehind keeps a string literal type such as `'from'` from matching.
 */
const specifierPattern = /(?<![\w'"$.])(?:from\s*|import\s*\(\s*|import\s*|require\s*\(\s*)(['"])([^'"\s]+)\1/g;

/** String literals are matched too, so a `/*` inside one does not start a comment. */
const commentPattern = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

/** A declaration file read from `source` and written to `destination`; the two differ for a copied file. */
interface DeclarationFile {
  readonly source:      string;
  readonly destination: string;
}

/** A module specifier found in a declaration file, with the offset of the specifier text itself. */
interface SpecifierReference {
  readonly specifier: string;
  readonly start:     number;
}

/** The inlined package: its folder and the declaration path it publishes for each `exports` key. */
interface SharedPackage {
  readonly folder:         string;
  readonly typesBySubpath: Record<string, string>;
}

/** The inlined package together with the scratch folder its declarations were emitted to. */
interface SharedDeclarations extends SharedPackage {
  readonly emittedFolder: string;
}

/**
 * Makes the declarations of a bundled jsii package self-contained with respect to one inlined
 * package: the declarations of that package which the package's own declarations reach are
 * copied into `lib/<package name>/`, and every specifier naming the inlined package is
 * rewritten to the relative path of its copy. esbuild inlines the JavaScript of that package
 * the same way. Declarations of other packages, and relative imports, are left as they are.
 * Needs `yarn` on the PATH and a `tsconfig.build.json` in the inlined package's folder.
 */
export class SharedDeclarationsInliner {
  private readonly copiesFolder: string;

  constructor(
    private readonly packageFolder: string,
    private readonly sharedPackageName: string,
  ) {
    this.copiesFolder = join(packageFolder, declarationsFolderName, sharedPackageName.split('/').pop() ?? sharedPackageName);
  }

  /**
   * Rewrites every declaration file in `lib/` (test folders excepted) that names the inlined
   * package, and copies the declarations they reach. Does nothing when no file names the package.
   * Rejects when the inlined package cannot be found or built, publishes no declaration file for a
   * specifier a file uses, or a relative import has no declaration file.
   */
  public async inline(): Promise<void> {
    const roots = await this.findDeclarationFiles();
    if (!(await this.anyReferencesSharedPackage(roots))) {
      return;
    }

    const shared        = await this.loadSharedPackage();
    const scratchFolder = await mkdtemp(join(tmpdir(), 'shared-declarations-'));
    try {
      const emittedFolder = join(scratchFolder, declarationsFolderName);
      await this.emitDeclarations(shared, emittedFolder);

      await rm(this.copiesFolder, { recursive: true, force: true });

      await this.rewriteClosure(roots, { ...shared, emittedFolder });
    } finally {
      await rm(scratchFolder, { recursive: true, force: true });
    }
  }

  private async findDeclarationFiles(): Promise<string[]> {
    return glob(join(this.packageFolder, declarationsFolderName, '**', `*${declarationSuffix}`), {
      ignore: [join(this.packageFolder, testFoldersGlob), join(this.copiesFolder, '**')],
    });
  }

  private async anyReferencesSharedPackage(files: string[]): Promise<boolean> {
    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      if (this.findReferences(content).some(reference => this.subpathOf(reference.specifier) !== undefined)) {
        return true;
      }
    }
    return false;
  }

  private async loadSharedPackage(): Promise<SharedPackage> {
    const packageRequire = createRequire(join(this.packageFolder, 'package.json'));
    const entryFile      = packageRequire.resolve(this.sharedPackageName);
    const folder         = await this.findPackageFolder(dirname(entryFile));

    const manifest = await readPackageJson(folder);
    const exported = manifest.publishConfig?.exports;
    if (exported === undefined) {
      throw new Error(`${join(folder, 'package.json')} has no publishConfig.exports to find the declaration files of ${this.sharedPackageName} in`);
    }

    const typesBySubpath: Record<string, string> = {};
    for (const [subpath, entry] of Object.entries(exported)) {
      if (typeof entry !== 'string' && entry.types !== undefined) {
        typesBySubpath[subpath] = entry.types;
      }
    }
    return { folder, typesBySubpath };
  }

  /** Walks up from the package's entry file to the folder whose package.json carries the package's name. */
  private async findPackageFolder(startFolder: string): Promise<string> {
    let folder = startFolder;
    while (!(await this.isSharedPackageFolder(folder))) {
      const parent = dirname(folder);
      if (parent === folder) {
        throw new Error(`No package.json named ${this.sharedPackageName} found above ${startFolder}`);
      }
      folder = parent;
    }
    return folder;
  }

  private async isSharedPackageFolder(folder: string): Promise<boolean> {
    try {
      const manifest = await readPackageJson(folder);
      return manifest.name === this.sharedPackageName;
    } catch (error) {
      return this.decideUnreadableManifest(error, folder);
    }
  }

  private decideUnreadableManifest(error: unknown, folder: string): false {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error instanceof Error ? error : new Error(`Cannot read the package.json in ${folder}: ${String(error)}`);
  }

  private async emitDeclarations(shared: SharedPackage, emittedFolder: string): Promise<void> {
    const args = ['tsc', '--emitDeclarationOnly', '--project', 'tsconfig.build.json', '--outDir', emittedFolder];

    const exitCode = await runWithInheritedStdio('yarn', args, shared.folder);
    if (exitCode !== 0) {
      const outcome = exitCode === null ? 'was terminated by a signal' : `exited with code ${exitCode}`;
      throw new Error(`yarn ${args.join(' ')} ${outcome} in ${shared.folder}`);
    }
  }

  private async rewriteClosure(roots: string[], shared: SharedDeclarations): Promise<void> {
    const files: DeclarationFile[] = roots.map(root => ({ source: root, destination: root }));
    const queued                   = new Set(roots);

    // The list grows while it is walked: each copied file is walked in turn.
    for (const file of files) {
      const content   = await readFile(file.source, 'utf-8');
      let rewritten   = '';
      let copiedUntil = 0;

      for (const reference of this.findReferences(content)) {
        const target = await this.resolveReference(file, reference.specifier, shared);
        if (target !== undefined && !queued.has(target.destination)) {
          queued.add(target.destination);
          files.push(target);
        }
        if (target !== undefined && this.subpathOf(reference.specifier) !== undefined) {
          rewritten  += content.slice(copiedUntil, reference.start) + this.relativeSpecifier(file.destination, target.destination);
          copiedUntil = reference.start + reference.specifier.length;
        }
      }
      rewritten += content.slice(copiedUntil);

      await mkdir(dirname(file.destination), { recursive: true });
      await writeFile(file.destination, rewritten);
    }
  }

  private async resolveReference(file: DeclarationFile, specifier: string, shared: SharedDeclarations): Promise<DeclarationFile | undefined> {
    const subpath = this.subpathOf(specifier);
    if (subpath !== undefined) {
      return this.resolveSharedDeclaration(specifier, subpath, shared);
    }
    if (specifier.startsWith('.')) {
      return this.resolveRelativeDeclaration(file, specifier, shared);
    }
    return undefined;
  }

  private resolveSharedDeclaration(specifier: string, subpath: string, shared: SharedDeclarations): DeclarationFile {
    const manifestPath = join(shared.folder, 'package.json');
    const types        = shared.typesBySubpath[subpath];
    if (types === undefined) {
      throw new Error(`${manifestPath} publishes no declaration file for '${specifier}' (publishConfig.exports["${subpath}"].types)`);
    }
    const emittedPath = relative(declarationsFolderName, join(types));
    if (emittedPath.startsWith('..')) {
      throw new Error(`${manifestPath} publishes '${specifier}' outside ${declarationsFolderName}/: ${types}`);
    }
    return this.copyOf(join(shared.emittedFolder, emittedPath), shared);
  }

  private async resolveRelativeDeclaration(file: DeclarationFile, specifier: string, shared: SharedDeclarations): Promise<DeclarationFile> {
    const base = join(dirname(file.source), specifier);
    for (const candidate of [`${base}${declarationSuffix}`, join(base, `index${declarationSuffix}`)]) {
      if (await this.exists(candidate)) {
        return file.source === file.destination ? { source: candidate, destination: candidate } : this.copyOf(candidate, shared);
      }
    }
    throw new Error(`${file.source} imports '${specifier}', which has no declaration file`);
  }

  private copyOf(emittedFile: string, shared: SharedDeclarations): DeclarationFile {
    return { source: emittedFile, destination: join(this.copiesFolder, relative(shared.emittedFolder, emittedFile)) };
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  /** The `exports` key a specifier names in the inlined package (`.` or `./sub`), or undefined for any other package. */
  private subpathOf(specifier: string): string | undefined {
    if (specifier === this.sharedPackageName) {
      return '.';
    }
    if (specifier.startsWith(`${this.sharedPackageName}/`)) {
      return `./${specifier.slice(this.sharedPackageName.length + 1)}`;
    }
    return undefined;
  }

  private relativeSpecifier(fromFile: string, toFile: string): string {
    const path = relative(dirname(fromFile), toFile).split(sep).join('/').slice(0, -declarationSuffix.length);
    return path.startsWith('.') ? path : `./${path}`;
  }

  private findReferences(content: string): SpecifierReference[] {
    const comments = [...content.matchAll(commentPattern)]
      .filter(match => match[0].startsWith('/'))
      .map(match => ({ start: match.index, end: match.index + match[0].length }));

    const references: SpecifierReference[] = [];
    for (const match of content.matchAll(specifierPattern)) {
      const insideComment = comments.some(comment => match.index >= comment.start && match.index < comment.end);
      if (!insideComment) {
        references.push({ specifier: match[2], start: match.index + match[0].length - match[2].length - 1 });
      }
    }
    return references;
  }
}
