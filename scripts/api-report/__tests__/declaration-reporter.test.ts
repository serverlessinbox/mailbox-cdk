import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir }                                        from 'node:os';
import * as path                                         from 'node:path';

import { DeclarationReporter }                           from '../declaration-reporter';

/**
 * Pins the report of a package's public surface: the declarations of the entry point and of every
 * file it reaches, without comments, in a fixed order. The API gate compares two reports as text, so
 * a file missing from the report, or a comment inside it, hides or invents a surface change.
 */
describe('DeclarationReporter', () => {
  const buildConfig = JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'commonjs', strict: true, declaration: true, outDir: 'lib', resolveJsonModule: true, esModuleInterop: true, skipLibCheck: true, types: [] },
    include:         ['src/**/*.ts', 'src/**/*.json'],
  });
  let packageDir: string;

  function writePackageFile(relativePath: string, content: string): void {
    const file = path.join(packageDir, relativePath);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }

  beforeEach(() => {
    packageDir = mkdtempSync(path.join(tmpdir(), 'declaration-reporter-'));
    writePackageFile('tsconfig.build.json', buildConfig);
  });

  afterEach(() => {
    rmSync(packageDir, { recursive: true, force: true });
  });

  it('reports the entry point and the files it reaches once each, in sorted order, even when files reference each other, without comments or unreached files', () => {
    writePackageFile('src/index.ts', "/** Entry docs. */\nexport * from './zeta/nested';\nexport * from './alpha';\n");
    writePackageFile('src/alpha.ts', "/** Alpha docs. */\nexport * from './zeta/nested';\nexport const alpha: string = 'a';\n");
    writePackageFile('src/zeta/nested.ts', "export * from '../alpha';\nexport interface Nested { readonly value: number }\n");
    writePackageFile('src/internal.ts', 'export const internal = 1;\n');

    const report = new DeclarationReporter(packageDir).report();

    expect(report).toBe([
      '// alpha.d.ts',
      "export * from './zeta/nested';",
      'export declare const alpha: string;',
      '',
      '// index.d.ts',
      "export * from './zeta/nested';",
      "export * from './alpha';",
      '',
      '// zeta/nested.d.ts',
      "export * from '../alpha';",
      'export interface Nested {',
      '    readonly value: number;',
      '}',
      '',
    ].join('\n'));
  });

  it('rejects, naming the file, when tsconfig.build.json cannot be read', () => {
    rmSync(path.join(packageDir, 'tsconfig.build.json'));

    expect(() => new DeclarationReporter(packageDir).report()).toThrow(`Cannot read ${path.join(packageDir, 'tsconfig.build.json')}`);
  });

  it('rejects with the compiler diagnostics when the package does not compile', () => {
    writePackageFile('src/index.ts', "export const broken: number = 'text';\n");

    expect(() => new DeclarationReporter(packageDir).report()).toThrow(/The package does not compile:\n.*index\.ts.*not assignable to type 'number'/s);
  });

  it('rejects naming the file when the entry point reaches a file the build emits no declaration for', () => {
    writePackageFile('src/data.json', '{ "name": "x" }\n');
    writePackageFile('src/index.ts', "import data from './data.json';\nexport const named: typeof data = data;\n");

    expect(() => new DeclarationReporter(packageDir).report()).toThrow('The build emitted no declaration file data.json.d.ts, which the entry point reaches');
  });
});
