import { build }                         from 'esbuild';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir }                        from 'os';
import { dirname, join }                 from 'path';

import { jsiiIgnorePlugin }              from '../jsii-ignore';

import { StubPluginBuild }               from './stub-plugin-build';

interface FixtureFile {
  readonly path:    string;
  readonly content: string;
}

const fixtures: FixtureFile[] = [
  { path: 'node_modules/jsii-lib/.jsii',         content: '{}' },
  { path: 'node_modules/jsii-lib/index.js',      content: "module.exports = { a: 'JSII_LIB_MARKER' };" },
  { path: 'node_modules/@scope/pkg/.jsii',       content: '{}' },
  { path: 'node_modules/@scope/pkg/index.js',    content: 'module.exports = {};' },
  { path: 'node_modules/plain-lib/index.js',     content: "module.exports = { p: 'PLAIN_LIB_MARKER' };" },
  { path: 'pkg/index.js',                        content: 'module.exports = {};' },
  { path: 'pkg/relative/.jsii',                  content: '{}' },
  { path: 'empty/placeholder.txt',               content: 'no entry file here' },
];

let root: string;
let packageFolder: string;

async function writeFixtures(files: FixtureFile[]): Promise<void> {
  for (const file of files) {
    const target = join(root, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
}

beforeEach(async () => {
  root          = await mkdtemp(join(tmpdir(), 'jsii-ignore-test-'));
  packageFolder = join(root, 'pkg');
  await writeFixtures(fixtures);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('jsiiIgnorePlugin', () => {
  describe('bundled output', () => {
    it('leaves an import of a jsii package external and bundles a plain package', async () => {
      const entryPath = join(packageFolder, 'entry.js');
      await writeFile(entryPath, "import { a } from 'jsii-lib';\nimport { p } from 'plain-lib';\nconsole.log(a, p);");

      const result = await build({
        entryPoints: [entryPath],
        bundle:      true,
        write:       false,
        platform:    'node',
        format:      'cjs',
        plugins:     [jsiiIgnorePlugin(packageFolder)],
      });
      const output = result.outputFiles.map(file => file.text).join('\n');

      expect(output).toContain('require("jsii-lib")');
      expect(output).not.toContain('JSII_LIB_MARKER');
      expect(output).toContain('PLAIN_LIB_MARKER');
    });

    it('marks a jsii package external for a package folder without a resolvable main', async () => {
      const emptyFolder = join(root, 'empty');
      const entry       = join(emptyFolder, 'entry.js');
      await writeFile(entry, "import { a } from 'jsii-lib';\nconsole.log(a);");

      const result = await build({
        entryPoints: [entry],
        bundle:      true,
        write:       false,
        platform:    'node',
        format:      'cjs',
        plugins:     [jsiiIgnorePlugin(emptyFolder)],
      });
      const output = result.outputFiles.map(file => file.text).join('\n');

      expect(output).toContain('require("jsii-lib")');
      expect(output).not.toContain('JSII_LIB_MARKER');
    });
  });

  describe('onResolve decisions', () => {
    let stub: StubPluginBuild;

    beforeEach(() => {
      stub = new StubPluginBuild();
      stub.registerPlugin(jsiiIgnorePlugin(packageFolder));
    });

    it('judges a deep import by the nearest ancestor package', async () => {
      await expect(stub.resolve({ kind: 'import-statement', path: 'jsii-lib/sub/file' }))
        .resolves.toEqual({ external: true });
    });

    it('judges a scoped deep import by its scope package', async () => {
      await expect(stub.resolve({ kind: 'import-statement', path: '@scope/pkg/sub/file' }))
        .resolves.toEqual({ external: true });
    });

    it('does not judge relative imports, even one that resolves to a folder holding a .jsii', async () => {
      await expect(stub.resolve({ kind: 'import-statement', path: './relative' }))
        .resolves.toBeUndefined();
    });

    it('does not judge require calls', async () => {
      await expect(stub.resolve({ kind: 'require-call', path: 'jsii-lib' }))
        .resolves.toBeUndefined();
    });
  });
});
