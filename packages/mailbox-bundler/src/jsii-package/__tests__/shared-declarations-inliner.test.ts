import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { existsSync }                              from 'fs';
import { tmpdir }                                  from 'os';
import { dirname, join }                           from 'path';

import { runWithInheritedStdio }                   from '../../utils/run-process';
import { SharedDeclarationsInliner }               from '../shared-declarations-inliner';

jest.mock('../../utils/run-process');

/*
 * A published package that inlines another package must not leave that package's name in its
 * declarations: consumers do not have it installed, so every such specifier fails to resolve in their
 * compiler. These fixtures are the tree `tsc` leaves in lib/ (specifiers still naming the inlined
 * package) and the tree `tsc` emits for the inlined package itself.
 */

const sharedName = '@scope/shared';

interface FixtureFile {
  readonly path:    string;
  readonly content: string;
}

const sharedManifest = JSON.stringify({
  name:          sharedName,
  main:          'src/index.ts',
  publishConfig: {
    exports: {
      '.':         { types: './lib/index.d.ts' },
      './runtime': { types: './lib/runtime.d.ts' },
      './extra':   { types: './lib/extra.d.ts' },
      './plain':   './lib/plain.js',
    },
  },
});

const emittedSharedDeclarations: FixtureFile[] = [
  { path: 'index.d.ts',        content: "import { Base } from './nested/base';\nimport type { IConstruct } from 'constructs';\nexport declare class Tag extends Base {\n    readonly scope: IConstruct;\n}\n" },
  { path: 'nested/base.d.ts',  content: 'export declare class Base {}\n' },
  { path: 'runtime.d.ts',      content: 'export type Rt = string;\n' },
  { path: 'extra.d.ts',        content: "export type { Rt } from '@scope/shared/runtime';\n" },
];

const packageDeclarations: FixtureFile[] = [
  {
    path:    'lib/index.d.ts',
    content: "export { Tag } from '@scope/shared';\nimport type { Rt } from '@scope/shared/runtime';\nexport * from './sub/own';\n",
  },
  {
    path:    'lib/sub/own.d.ts',
    content: [
      '/**',
      " * Uses `import { Tag } from '@scope/shared'` in its documentation only.",
      ' */',
      'export declare const own: import("@scope/shared").Tag;',
      "export declare const kind: 'from' | 'import';",
      "// import type { Rt } from '@scope/shared/runtime'",
      '',
    ].join('\n'),
  },
  { path: 'lib/__tests__/own.d.ts', content: "import { Tag } from '@scope/shared';\n" },
];

let workFolder: string;
let packageFolder: string;
let sharedFolder: string;

async function writeFixtures(root: string, files: FixtureFile[]): Promise<void> {
  for (const file of files) {
    const target = join(root, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
}

async function readLib(path: string): Promise<string> {
  return readFile(join(packageFolder, 'lib', path), 'utf-8');
}

function emitInto(files: FixtureFile[]): void {
  jest.mocked(runWithInheritedStdio).mockImplementation(async (_command, args) => {
    await writeFixtures(args[args.indexOf('--outDir') + 1], files);
    return 0;
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  emitInto(emittedSharedDeclarations);

  workFolder    = await mkdtemp(join(tmpdir(), 'shared-declarations-test-'));
  packageFolder = join(workFolder, 'pkg');
  sharedFolder  = join(packageFolder, 'node_modules', '@scope', 'shared');
  await writeFixtures(packageFolder, [{ path: 'package.json', content: '{"name":"pkg"}' }, ...packageDeclarations]);
  await writeFixtures(sharedFolder, [
    { path: 'package.json', content: sharedManifest },
    { path: 'src/index.ts', content: '' },
  ]);
});

afterEach(async () => {
  await rm(workFolder, { recursive: true, force: true });
});

describe('SharedDeclarationsInliner.inline', () => {
  it('rewrites each specifier naming the inlined package to the relative path of its copy', async () => {
    await new SharedDeclarationsInliner(packageFolder, sharedName).inline();

    await expect(readLib('index.d.ts')).resolves.toBe("export { Tag } from './shared/index';\nimport type { Rt } from './shared/runtime';\nexport * from './sub/own';\n");
    await expect(readLib('sub/own.d.ts')).resolves.toContain('export declare const own: import("../shared/index").Tag;');
  });

  it('copies the declarations the files reach, and the files those import, keeping other packages external', async () => {
    await new SharedDeclarationsInliner(packageFolder, sharedName).inline();

    await expect(readLib('shared/index.d.ts')).resolves.toBe(emittedSharedDeclarations[0].content);
    await expect(readLib('shared/nested/base.d.ts')).resolves.toBe(emittedSharedDeclarations[1].content);
    await expect(readLib('shared/runtime.d.ts')).resolves.toBe(emittedSharedDeclarations[2].content);
  });

  it('copies only the declarations that are reached', async () => {
    await new SharedDeclarationsInliner(packageFolder, sharedName).inline();

    expect(existsSync(join(packageFolder, 'lib', 'shared', 'extra.d.ts'))).toBe(false);
  });

  it('rewrites the specifiers inside a copied file that name the inlined package', async () => {
    await writeFixtures(packageFolder, [{ path: 'lib/more.d.ts', content: "export type { Rt } from '@scope/shared/extra';\n" }]);

    await new SharedDeclarationsInliner(packageFolder, sharedName).inline();

    await expect(readLib('shared/extra.d.ts')).resolves.toBe("export type { Rt } from './runtime';\n");
  });

  it('leaves test folders alone', async () => {
    await new SharedDeclarationsInliner(packageFolder, sharedName).inline();

    await expect(readLib('__tests__/own.d.ts')).resolves.toBe("import { Tag } from '@scope/shared';\n");
  });

  it('emits the inlined package declarations with tsc in its folder, into a scratch folder', async () => {
    await new SharedDeclarationsInliner(packageFolder, sharedName).inline();

    expect(runWithInheritedStdio).toHaveBeenCalledTimes(1);
    expect(runWithInheritedStdio).toHaveBeenCalledWith(
      'yarn',
      ['tsc', '--emitDeclarationOnly', '--project', 'tsconfig.build.json', '--outDir', expect.stringMatching(/shared-declarations-[^/]+\/lib$/)],
      expect.stringMatching(/node_modules\/@scope\/shared$/),
    );
  });

  it('replaces copies left by an earlier run', async () => {
    await writeFixtures(packageFolder, [{ path: 'lib/shared/stale.d.ts', content: 'export {};\n' }]);

    await new SharedDeclarationsInliner(packageFolder, sharedName).inline();

    expect(existsSync(join(packageFolder, 'lib', 'shared', 'stale.d.ts'))).toBe(false);
  });

  it('does nothing when no declaration names the inlined package', async () => {
    await writeFixtures(packageFolder, [{ path: 'lib/index.d.ts', content: "export * from './sub/own';\n" }, { path: 'lib/sub/own.d.ts', content: 'export {};\n' }]);

    await new SharedDeclarationsInliner(packageFolder, sharedName).inline();

    expect(runWithInheritedStdio).not.toHaveBeenCalled();
    expect(existsSync(join(packageFolder, 'lib', 'shared'))).toBe(false);
  });

  it('rejects naming the specifier when the inlined package publishes no declaration file for it', async () => {
    await writeFixtures(packageFolder, [{ path: 'lib/more.d.ts', content: "export type { Nope } from '@scope/shared/plain';\n" }]);

    await expect(new SharedDeclarationsInliner(packageFolder, sharedName).inline())
      .rejects.toThrow(`publishes no declaration file for '@scope/shared/plain'`);
  });

  it('rejects when the inlined package has no publishConfig.exports', async () => {
    await writeFixtures(sharedFolder, [{ path: 'package.json', content: JSON.stringify({ name: sharedName, main: 'src/index.ts' }) }]);

    await expect(new SharedDeclarationsInliner(packageFolder, sharedName).inline())
      .rejects.toThrow('has no publishConfig.exports to find the declaration files of @scope/shared in');
  });

  it('rejects naming the specifier when the inlined package publishes its declaration file outside lib/', async () => {
    const manifest = JSON.stringify({
      name:          sharedName,
      main:          'src/index.ts',
      publishConfig: { exports: { '.': { types: './lib/index.d.ts' }, './outside': { types: './dist/outside.d.ts' } } },
    });
    await writeFixtures(sharedFolder, [{ path: 'package.json', content: manifest }]);
    await writeFixtures(packageFolder, [{ path: 'lib/more.d.ts', content: "export type { Out } from '@scope/shared/outside';\n" }]);

    await expect(new SharedDeclarationsInliner(packageFolder, sharedName).inline())
      .rejects.toThrow("publishes '@scope/shared/outside' outside lib/: ./dist/outside.d.ts");
  });

  it('rejects when no package.json above the resolved entry carries the inlined package name', async () => {
    await writeFixtures(sharedFolder, [{ path: 'package.json', content: JSON.stringify({ name: 'someone-else', main: 'src/index.ts' }) }]);

    await expect(new SharedDeclarationsInliner(packageFolder, sharedName).inline())
      .rejects.toThrow(/No package\.json named @scope\/shared found above .*shared[\\/]src$/);
  });

  it('rethrows a package.json that exists but cannot be read instead of walking past it', async () => {
    await writeFixtures(sharedFolder, [{ path: 'src/package.json/placeholder', content: '' }]);

    await expect(new SharedDeclarationsInliner(packageFolder, sharedName).inline()).rejects.toThrow('EISDIR');
  });

  it('rejects with the exit code when tsc exits non-zero', async () => {
    jest.mocked(runWithInheritedStdio).mockResolvedValue(2);

    await expect(new SharedDeclarationsInliner(packageFolder, sharedName).inline()).rejects.toThrow('exited with code 2');
  });

  it('rejects when tsc is killed by a signal', async () => {
    jest.mocked(runWithInheritedStdio).mockResolvedValue(null);

    await expect(new SharedDeclarationsInliner(packageFolder, sharedName).inline()).rejects.toThrow('terminated by a signal');
  });

  it('rejects naming the file when a relative import has no declaration file', async () => {
    await writeFixtures(packageFolder, [{ path: 'lib/broken.d.ts', content: "export * from './missing';\n" }]);

    await expect(new SharedDeclarationsInliner(packageFolder, sharedName).inline())
      .rejects.toThrow(`${join(packageFolder, 'lib', 'broken.d.ts')} imports './missing', which has no declaration file`);
  });
});
