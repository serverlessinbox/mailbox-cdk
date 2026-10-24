import { build }                                   from 'esbuild';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises';
import { tmpdir }                                  from 'os';
import { join }                                    from 'path';

import { localLibImportPlugin }                    from '../local-lib-import';

import { StubPluginBuild }                         from './stub-plugin-build';

const stubPackageFolder = '/r/mailbox';

describe('localLibImportPlugin', () => {
  describe('bundled output', () => {
    let root: string;
    let packageFolder: string;

    beforeEach(async () => {
      root          = await realpath(await mkdtemp(join(tmpdir(), 'local-lib-import-test-')));
      packageFolder = join(root, 'mailbox');
      await mkdir(join(packageFolder, 'src'), { recursive: true });
      await writeFile(join(packageFolder, 'src', 'entry.js'), "import { h } from './helper.js';\nconsole.log(h);");
      await writeFile(join(packageFolder, 'src', 'helper.js'), "module.exports = { h: 'HELPER_MARKER' };");
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    async function bundleFrom(entry: string): Promise<string> {
      const result = await build({
        entryPoints: [entry],
        bundle:      true,
        write:       false,
        platform:    'node',
        format:      'cjs',
        plugins:     [localLibImportPlugin(packageFolder)],
      });
      return result.outputFiles.map(file => file.text).join('\n');
    }

    it('leaves a relative import made by a file in the package external', async () => {
      const output = await bundleFrom(join(packageFolder, 'src', 'entry.js'));

      expect(output).toContain('require("./helper.js")');
      expect(output).not.toContain('HELPER_MARKER');
    });

    it('bundles a relative import made by a sibling folder that shares the name prefix', async () => {
      const siblingFolder = join(root, 'mailbox-cdk-shared');
      await mkdir(siblingFolder, { recursive: true });
      await writeFile(join(siblingFolder, 'entry.js'), "import { h } from './helper.js';\nconsole.log(h);");
      await writeFile(join(siblingFolder, 'helper.js'), "module.exports = { h: 'SIBLING_HELPER_MARKER' };");

      const output = await bundleFrom(join(siblingFolder, 'entry.js'));

      expect(output).toContain('SIBLING_HELPER_MARKER');
      expect(output).not.toContain('require("./helper.js")');
    });
  });

  describe('onResolve decisions', () => {
    let stub: StubPluginBuild;

    beforeEach(() => {
      stub = new StubPluginBuild();
      stub.registerPlugin(localLibImportPlugin(stubPackageFolder));
    });

    it('bundles a relative import made by a file outside the package folder', async () => {
      await expect(stub.resolve({
        kind:     'import-statement',
        path:     '../mailbox/src/helper.js',
        importer: '/r/outside/entry.js',
      })).resolves.toBeUndefined();
    });

    it('does not judge non-relative imports', async () => {
      await expect(stub.resolve({
        kind:     'import-statement',
        path:     'plain-lib',
        importer: '/r/mailbox/src/plain.js',
      })).resolves.toBeUndefined();
    });

    it('does not judge require calls', async () => {
      await expect(stub.resolve({
        kind:     'require-call',
        path:     './helper.js',
        importer: '/r/mailbox/src/required.js',
      })).resolves.toBeUndefined();
    });
  });
});
