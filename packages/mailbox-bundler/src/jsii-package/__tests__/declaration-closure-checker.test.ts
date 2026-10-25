import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir }                        from 'os';
import { dirname, join }                 from 'path';

import { DeclarationClosureChecker }     from '../declaration-closure-checker';

/*
 * A published package whose declarations name a package its consumers do not get installed breaks
 * their compiler. The fixtures are a package folder with a package.json and the `lib/` tree a build
 * leaves; the checker must flag exactly the bare imports its closure reaches.
 */

let packageFolder: string;

async function writeFiles(files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(packageFolder, path)), { recursive: true });
    await writeFile(join(packageFolder, path), content);
  }
}

async function writePackage(manifest: object, declarations: Record<string, string>): Promise<void> {
  await writeFiles({
    'package.json': JSON.stringify({ name: 'pkg', publishConfig: { types: 'lib/index.d.ts' }, ...manifest }),
    ...declarations,
  });
}

beforeEach(async () => {
  packageFolder = await mkdtemp(join(tmpdir(), 'declaration-closure-checker-test-'));
});

afterEach(async () => {
  await rm(packageFolder, { recursive: true, force: true });
});

describe('DeclarationClosureChecker.check', () => {
  it('names the file and the specifier of an undeclared package the entry imports', async () => {
    await writePackage({}, { 'lib/index.d.ts': "import * as t from 'typanion';\nexport declare const x: t.A;\n" });

    await expect(new DeclarationClosureChecker(packageFolder).check()).resolves.toEqual([
      "lib/index.d.ts imports 'typanion', which is neither a dependency nor a peer dependency of pkg",
    ]);
  });

  it('finds an undeclared package in a file reached through relative imports, an index folder and a reference path', async () => {
    await writePackage({}, {
      'lib/index.d.ts':     "/// <reference path=\"./ref.d.ts\" />\nexport * from './sub';\n",
      'lib/ref.d.ts':       "export type R = import('ref-only').R;\n",
      'lib/sub/index.d.ts': "export { Deep } from './deep';\n",
      'lib/sub/deep.d.ts':  "import type { X } from '@scope/missing/inner';\nexport declare class Deep {}\n",
    });

    const violations = await new DeclarationClosureChecker(packageFolder).check();

    expect(violations).toEqual([
      "lib/ref.d.ts imports 'ref-only', which is neither a dependency nor a peer dependency of pkg",
      "lib/sub/deep.d.ts imports '@scope/missing/inner', which is neither a dependency nor a peer dependency of pkg",
    ]);
  });

  it('accepts dependencies, peer dependencies by package name, and Node built-ins', async () => {
    await writePackage(
      { dependencies: { '@scope/dep': '^1.0.0' }, peerDependencies: { 'aws-cdk-lib': '^2.0.0' } },
      {
        'lib/index.d.ts': [
          "import { Function } from 'aws-cdk-lib/aws-lambda';",
          "import type { Dep } from '@scope/dep/sub';",
          "import type { Buffer } from 'node:buffer';",
          "import type { Stats } from 'fs/promises';",
          'export declare const x: Function | Dep | Buffer | Stats;',
          '',
        ].join('\n'),
      },
    );

    await expect(new DeclarationClosureChecker(packageFolder).check()).resolves.toEqual([]);
  });

  it('flags a relative import that has no declaration file', async () => {
    await writePackage({}, { 'lib/index.d.ts': "export * from './missing';\n" });

    await expect(new DeclarationClosureChecker(packageFolder).check()).resolves.toEqual([
      "lib/index.d.ts imports './missing', which has no declaration file",
    ]);
  });

  it('ignores specifiers in comments and a declaration file the entry does not reach', async () => {
    await writePackage({}, {
      'lib/index.d.ts':  "// import type { A } from 'typanion'\nexport declare const kind: 'from';\n",
      'lib/orphan.d.ts': "import 'typanion';\n",
    });

    await expect(new DeclarationClosureChecker(packageFolder).check()).resolves.toEqual([]);
  });

  it('rejects naming package.json when it has no publishConfig.types', async () => {
    await writeFiles({ 'package.json': '{"name":"pkg"}' });

    await expect(new DeclarationClosureChecker(packageFolder).check()).rejects.toThrow(
      `${join(packageFolder, 'package.json')} has no publishConfig.types`,
    );
  });
});

describe('DeclarationClosureChecker.countUndeclaredOutsideClosure', () => {
  it('counts the files outside the closure that name an undeclared package, not those that name declared ones', async () => {
    await writePackage({ dependencies: { declared: '1' } }, {
      'lib/index.d.ts':    'export declare const x: number;\n',
      'lib/orphan-a.d.ts': "import 'typanion';\n",
      'lib/orphan-b.d.ts': "import 'declared';\n",
      'lib/deep/c.d.ts':   "export type C = import('other').C;\n",
    });

    await expect(new DeclarationClosureChecker(packageFolder).countUndeclaredOutsideClosure()).resolves.toBe(2);
  });
});
